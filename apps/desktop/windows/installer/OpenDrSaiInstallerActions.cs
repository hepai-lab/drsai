using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using Microsoft.Deployment.WindowsInstaller;

namespace OpenDrSai.Installer
{
    public static class InstallerActions
    {
        private const int TotalProgressTicks = 1000;
        private const int DownloadProgressTicks = 600;
        private const int BufferSize = 1024 * 1024;

        [CustomAction]
        public static ActionResult DownloadRuntime(Session session)
        {
            string partialPath = null;
            try
            {
                string runtimeUrl = session.CustomActionData["RuntimeUrl"];
                string sourcePath = session.CustomActionData["SourcePath"];
                string targetPath = session.CustomActionData["TargetPath"];
                string bootstrapperVersion = session.CustomActionData["BootstrapperVersion"];
                long expectedSize = long.Parse(
                    session.CustomActionData["ExpectedSize"],
                    CultureInfo.InvariantCulture);

                Directory.CreateDirectory(Path.GetDirectoryName(targetPath));
                partialPath = targetPath + ".partial";
                DeleteIfPresent(partialPath);

                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
                string runtimeSource = ResolveRuntimeSource(session, sourcePath, runtimeUrl);
                return Download(session, runtimeSource, partialPath, targetPath, expectedSize, bootstrapperVersion);
            }
            catch (Exception ex)
            {
                session.Log("OpenDrSai Runtime download failed: " + ex);
                ShowError(session, ex.Message);
                DeleteIfPresent(partialPath);
                return ActionResult.Failure;
            }
        }

        [CustomAction]
        public static ActionResult RunInstallerStage(Session session)
        {
            Process process = null;
            string progressFile = null;
            try
            {
                string stage = session.CustomActionData["Stage"];
                string scriptPath = session.CustomActionData["ScriptPath"];
                string installRoot = session.CustomActionData["InstallRoot"];
                string runtimeUrl = session.CustomActionData["RuntimeUrl"];
                string runtimeSha256 = session.CustomActionData["RuntimeSha256"];
                string runtimeSizeBytes = session.CustomActionData["RuntimeSizeBytes"];
                string bootstrapperVersion = session.CustomActionData["BootstrapperVersion"];
                string installSessionId = session.CustomActionData["InstallSessionId"];
                string extraInstallArgs = session.CustomActionData.ContainsKey("ExtraInstallArgs")
                    ? session.CustomActionData["ExtraInstallArgs"]
                    : string.Empty;
                progressFile = session.CustomActionData["ProgressFile"];
                int stageTicks = int.Parse(
                    session.CustomActionData["Ticks"],
                    CultureInfo.InvariantCulture);
                if (stageTicks <= 0 || stageTicks > TotalProgressTicks)
                {
                    throw new InvalidDataException("Progress ticks must be between 1 and 1000.");
                }

                DeleteIfPresent(progressFile);
                ProcessStartInfo startInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = string.Join(" ", new[]
                    {
                        "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden",
                        "-File " + QuoteArgument(scriptPath),
                        "-Stage " + QuoteArgument(stage),
                        "-InstallRoot " + QuoteArgument(installRoot),
                        "-RuntimeUrl " + QuoteArgument(runtimeUrl),
                        "-RuntimeSha256 " + QuoteArgument(runtimeSha256),
                        "-RuntimeSizeBytes " + QuoteArgument(runtimeSizeBytes),
                        "-BootstrapperVersion " + QuoteArgument(bootstrapperVersion),
                        "-InstallSessionId " + QuoteArgument(installSessionId),
                        "-ProgressFile " + QuoteArgument(progressFile),
                        "-MachineInstall -NoShortcuts -NoLaunch -Quiet",
                        extraInstallArgs
                    }),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                process = Process.Start(startInfo);
                if (process == null)
                {
                    throw new InvalidOperationException("Could not start the OpenDrSai installer stage.");
                }

                int reportedPercent = 0;
                string lastDetail = string.Empty;
                while (!process.WaitForExit(100))
                {
                    if (!ReportStageFile(session, progressFile, stageTicks, ref reportedPercent, ref lastDetail))
                    {
                        try { process.Kill(); } catch { }
                        return ActionResult.UserExit;
                    }
                }
                ReportStageFile(session, progressFile, stageTicks, ref reportedPercent, ref lastDetail);
                if (process.ExitCode != 0)
                {
                    throw new InvalidOperationException(string.Format(
                        CultureInfo.InvariantCulture,
                        "OpenDrSai installer stage {0} failed with exit code {1}. See the installer log under ProgramData\\OpenDrSai\\Installer\\logs.",
                        stage,
                        process.ExitCode));
                }
                if (reportedPercent < 100)
                {
                    ReportProgress(session, stageTicks - (reportedPercent * stageTicks / 100));
                }
                return ActionResult.Success;
            }
            catch (Exception ex)
            {
                session.Log("OpenDrSai installer stage failed: " + ex);
                ShowError(session, ex.Message);
                return ActionResult.Failure;
            }
            finally
            {
                if (process != null) process.Dispose();
                DeleteIfPresent(progressFile);
            }
        }

        private static bool ReportStageFile(
            Session session,
            string progressFile,
            int stageTicks,
            ref int reportedPercent,
            ref string lastDetail)
        {
            if (string.IsNullOrEmpty(progressFile) || !File.Exists(progressFile)) return true;
            string progress;
            try
            {
                progress = File.ReadAllText(progressFile);
            }
            catch (IOException)
            {
                return true;
            }
            int separator = progress.IndexOf('\t');
            if (separator <= 0) return true;
            int percent;
            if (!int.TryParse(progress.Substring(0, separator), NumberStyles.Integer, CultureInfo.InvariantCulture, out percent))
            {
                return true;
            }
            percent = Math.Max(0, Math.Min(100, percent));
            if (percent > reportedPercent)
            {
                int previousTicks = reportedPercent * stageTicks / 100;
                int targetTicks = percent * stageTicks / 100;
                if (targetTicks > previousTicks) ReportProgress(session, targetTicks - previousTicks);
                reportedPercent = percent;
            }
            string detail = progress.Substring(separator + 1).Trim();
            if (detail.Length > 0 && !string.Equals(detail, lastDetail, StringComparison.Ordinal))
            {
                lastDetail = detail;
                return SendActionData(session, detail);
            }
            return true;
        }

        private static string QuoteArgument(string value)
        {
            return "\"" + (value ?? string.Empty).Replace("\"", "\\\"") + "\"";
        }

        private static string ResolveRuntimeSource(Session session, string sourcePath, string runtimeUrl)
        {
            if (!string.IsNullOrWhiteSpace(sourcePath))
            {
                string setupDirectory = Path.GetDirectoryName(Path.GetFullPath(sourcePath));
                if (!string.IsNullOrEmpty(setupDirectory))
                {
                    string adjacentRuntime = Path.Combine(
                        setupDirectory,
                        string.Format(CultureInfo.InvariantCulture, "OpenDrSai-Windows-v{0}-x64.zip", session.CustomActionData["BootstrapperVersion"]));
                    if (File.Exists(adjacentRuntime))
                    {
                        session.Log("Using OpenDrSai Runtime package beside Setup: " + adjacentRuntime);
                        SendActionData(session, "Using the OpenDrSai Runtime package beside Setup...");
                        return new Uri(adjacentRuntime).AbsoluteUri;
                    }
                }
            }

            session.Log("No Runtime package was found beside Setup; downloading from: " + runtimeUrl);
            return runtimeUrl;
        }

        private static ActionResult Download(
            Session session,
            string runtimeUrl,
            string partialPath,
            string targetPath,
            long expectedSize,
            string bootstrapperVersion)
        {
            Stream source = null;
            IDisposable responseOwner = null;
            try
            {
                if (!SendActionData(session, "Connecting to the OpenDrSai download server..."))
                {
                    return ActionResult.UserExit;
                }
                long responseSize;
                OpenSource(runtimeUrl, bootstrapperVersion, out source, out responseOwner, out responseSize);
                if (expectedSize > 0 && responseSize > 0 && responseSize != expectedSize)
                {
                    throw new InvalidDataException(string.Format(
                        CultureInfo.InvariantCulture,
                        "The published Runtime is {0} bytes, but this installer expects {1} bytes. " +
                        "Download the matching OpenDrSai Setup version or contact the package publisher.",
                        responseSize,
                        expectedSize));
                }
                long totalSize = expectedSize > 0 ? expectedSize : responseSize;
                if (totalSize <= 0)
                {
                    throw new InvalidOperationException("Runtime download size is unknown.");
                }

                ResetProgressTotal(session, TotalProgressTicks);
                SendStatus(session, 0, 0, totalSize, 0);

                byte[] buffer = new byte[BufferSize];
                long downloaded = 0;
                long lastSampleBytes = 0;
                int reportedTicks = 0;
                bool canceled = false;
                Stopwatch totalWatch = Stopwatch.StartNew();
                Stopwatch sampleWatch = Stopwatch.StartNew();

                using (FileStream destination = new FileStream(
                    partialPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    BufferSize,
                    FileOptions.SequentialScan))
                {
                    while (true)
                    {
                        int read = source.Read(buffer, 0, buffer.Length);
                        if (read <= 0) break;
                        destination.Write(buffer, 0, read);
                        downloaded += read;

                        int targetTicks = (int)Math.Min(
                            DownloadProgressTicks,
                            downloaded * DownloadProgressTicks / totalSize);
                        if (targetTicks > reportedTicks)
                        {
                            ReportProgress(session, targetTicks - reportedTicks);
                            reportedTicks = targetTicks;
                        }

                        if (sampleWatch.ElapsedMilliseconds >= 250 || downloaded >= totalSize)
                        {
                            double seconds = Math.Max(0.001, sampleWatch.Elapsed.TotalSeconds);
                            double bytesPerSecond = (downloaded - lastSampleBytes) / seconds;
                            if (!SendStatus(session, downloaded, downloaded, totalSize, bytesPerSecond))
                            {
                                canceled = true;
                                break;
                            }
                            lastSampleBytes = downloaded;
                            sampleWatch.Restart();
                        }
                    }
                    destination.Flush(true);
                }

                if (canceled)
                {
                    DeleteIfPresent(partialPath);
                    return ActionResult.UserExit;
                }

                if (expectedSize > 0 && downloaded != expectedSize)
                {
                    throw new InvalidDataException(string.Format(
                        CultureInfo.InvariantCulture,
                        "Runtime size mismatch. Expected {0} bytes, downloaded {1} bytes.",
                        expectedSize,
                        downloaded));
                }

                if (reportedTicks < DownloadProgressTicks)
                {
                    ReportProgress(session, DownloadProgressTicks - reportedTicks);
                }
                double averageSpeed = downloaded / Math.Max(0.001, totalWatch.Elapsed.TotalSeconds);
                SendStatus(session, downloaded, downloaded, totalSize, averageSpeed);

                DeleteIfPresent(targetPath);
                File.Move(partialPath, targetPath);
                return ActionResult.Success;
            }
            finally
            {
                if (source != null) source.Dispose();
                if (responseOwner != null) responseOwner.Dispose();
            }
        }

        private static void OpenSource(
            string runtimeUrl,
            string bootstrapperVersion,
            out Stream source,
            out IDisposable responseOwner,
            out long contentLength)
        {
            source = null;
            responseOwner = null;
            contentLength = 0;

            Uri uri;
            if (Uri.TryCreate(runtimeUrl, UriKind.Absolute, out uri) && uri.IsFile)
            {
                FileStream file = new FileStream(
                    uri.LocalPath,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read,
                    BufferSize,
                    FileOptions.SequentialScan);
                source = file;
                contentLength = file.Length;
                return;
            }

            if (uri == null || uri.Scheme != Uri.UriSchemeHttps)
            {
                throw new InvalidOperationException("Runtime URL must use HTTPS or file://.");
            }

            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(uri);
            request.Timeout = 60000;
            request.ReadWriteTimeout = 300000;
            request.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            request.UserAgent = "OpenDrSai-Setup/" + bootstrapperVersion;
            request.Proxy = WebRequest.DefaultWebProxy;
            if (request.Proxy != null)
            {
                request.Proxy.Credentials = CredentialCache.DefaultCredentials;
            }

            WebResponse response;
            try
            {
                response = request.GetResponse();
            }
            catch (WebException ex)
            {
                throw new InvalidOperationException(
                    "Could not connect to the OpenDrSai download server within 60 seconds. " +
                    "Check this Windows environment's Internet or system proxy settings, then retry. " +
                    "Download URL: " + runtimeUrl,
                    ex);
            }
            responseOwner = response;
            contentLength = response.ContentLength;
            source = response.GetResponseStream();
        }

        private static bool SendStatus(
            Session session,
            long downloadedForPercent,
            long downloaded,
            long total,
            double bytesPerSecond)
        {
            int percent = total > 0
                ? (int)Math.Min(100, downloadedForPercent * 100 / total)
                : 0;
            double megabytesPerSecond = bytesPerSecond / 1048576.0;
            string speed = megabytesPerSecond >= 0.1 || bytesPerSecond <= 0
                ? string.Format(CultureInfo.InvariantCulture, "{0:F1} MB/s", megabytesPerSecond)
                : string.Format(CultureInfo.InvariantCulture, "{0:F0} KB/s", bytesPerSecond / 1024.0);
            string text = string.Format(
                CultureInfo.InvariantCulture,
                "{0}%   {1:F1} / {2:F1} MB   {3}",
                percent,
                downloaded / 1048576.0,
                total / 1048576.0,
                speed);
            session.Log("OpenDrSai Runtime download progress: " + text);
            return SendActionData(session, text);
        }

        private static bool SendActionData(Session session, string text)
        {
            session.Log("OpenDrSai installer status: " + text);
            using (Record record = new Record(1))
            {
                record.SetString(1, text);
                MessageResult result = session.Message(InstallMessage.ActionData, record);
                return result != MessageResult.Cancel && result != MessageResult.Abort;
            }
        }

        private static void ResetProgressTotal(Session session, int ticks)
        {
            using (Record record = new Record(4))
            {
                record.SetInteger(1, 0);
                record.SetInteger(2, ticks);
                record.SetInteger(3, 0);
                record.SetInteger(4, 0);
                session.Message(InstallMessage.Progress, record);
            }
        }

        private static void ReportProgress(Session session, int ticks)
        {
            using (Record record = new Record(4))
            {
                record.SetInteger(1, 2);
                record.SetInteger(2, ticks);
                record.SetInteger(3, 0);
                record.SetInteger(4, 0);
                session.Message(InstallMessage.Progress, record);
            }
        }

        private static void DeleteIfPresent(string path)
        {
            if (!string.IsNullOrEmpty(path) && File.Exists(path))
            {
                File.Delete(path);
            }
        }

        private static void ShowError(Session session, string detail)
        {
            using (Record record = new Record(2))
            {
                record.SetInteger(1, 25001);
                record.SetString(2, detail);
                session.Message(InstallMessage.Error, record);
            }
        }
    }
}
