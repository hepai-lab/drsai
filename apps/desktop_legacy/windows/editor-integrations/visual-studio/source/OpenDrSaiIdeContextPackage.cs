using System;
using System.ComponentModel.Design;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio.Shell;

namespace OpenDrSai.IdeContext;

internal sealed class OpenDrSaiIdeContextPackage : AsyncPackage
{
    private const string ContextRelativePath = ".drsai\\ide-context.json";
    private const int MaxSelectionChars = 12000;

    protected override async Task InitializeAsync(
        CancellationToken cancellationToken,
        IProgress<ServiceProgressData> progress)
    {
        await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
        var commandService = await GetServiceAsync(typeof(IMenuCommandService)) as OleMenuCommandService;
        commandService?.AddCommand(new MenuCommand(
            (_, _) => JoinableTaskFactory.RunAsync(CaptureIdeContextAsync).FireAndForget(),
            new CommandID(Guid.Parse("d58cfbb3-0693-47a9-9e87-4f451f0194bf"), 0x0100)));
    }

    private async Task CaptureIdeContextAsync()
    {
        await JoinableTaskFactory.SwitchToMainThreadAsync();
        var dte = await GetServiceAsync(typeof(DTE)) as DTE2;
        var document = dte?.ActiveDocument;
        if (document?.FullName is null || !File.Exists(document.FullName)) return;

        var workspaceRoot = ResolveSolutionRoot(dte);
        if (workspaceRoot is null) return;

        var filePath = Path.GetFullPath(document.FullName);
        if (!IsInsidePath(workspaceRoot, filePath)) return;

        var relativePath = Path.GetRelativePath(workspaceRoot, filePath).Replace('\\', '/');
        var selection = document.Selection as TextSelection;
        var selectedText = (selection?.Text ?? string.Empty).Replace("\0", string.Empty).Trim();
        var language = Path.GetExtension(filePath).TrimStart('.').ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(language)) language = document.Language?.ToLowerInvariant() ?? "text";

        var payload = new IdeContextPayload
        {
            Source = "visual_studio",
            CapturedAt = DateTimeOffset.UtcNow,
            CurrentFile = new IdeContextFile
            {
                Path = filePath,
                RelativePath = relativePath,
                Language = language,
                Line = Math.Max(1, selection?.ActivePoint.Line ?? 1),
                Column = Math.Max(1, selection?.ActivePoint.LineCharOffset ?? 1),
            },
            CurrentSelection = string.IsNullOrWhiteSpace(selectedText)
                ? null
                : new IdeContextSelection
                {
                    Path = filePath,
                    RelativePath = relativePath,
                    Text = selectedText.Length > MaxSelectionChars
                        ? selectedText.Substring(0, MaxSelectionChars)
                        : selectedText,
                    StartLine = Math.Max(1, selection?.TopPoint.Line ?? 1),
                    EndLine = Math.Max(1, selection?.BottomPoint.Line ?? 1),
                    Language = language,
                    Truncated = selectedText.Length > MaxSelectionChars,
                },
        };

        WriteWorkspaceContext(workspaceRoot, payload);
    }

    private static string? ResolveSolutionRoot(DTE2? dte)
    {
        var solutionPath = dte?.Solution?.FullName;
        if (string.IsNullOrWhiteSpace(solutionPath)) return null;
        var solutionRoot = Path.GetDirectoryName(solutionPath);
        return solutionRoot is null ? null : Path.GetFullPath(solutionRoot);
    }

    private static void WriteWorkspaceContext(string workspaceRoot, IdeContextPayload payload)
    {
        var contextPath = Path.GetFullPath(Path.Combine(workspaceRoot, ContextRelativePath));
        if (!IsInsidePath(workspaceRoot, contextPath)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(contextPath)!);
        var tempPath = $"{contextPath}.{Environment.ProcessId}.tmp";
        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        });
        File.WriteAllText(tempPath, json + Environment.NewLine, Encoding.UTF8);
        File.Move(tempPath, contextPath, true);
    }

    private static bool IsInsidePath(string parentPath, string childPath)
    {
        var parent = Path.GetFullPath(parentPath).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var child = Path.GetFullPath(childPath);
        return child.Length > parent.Length && child.StartsWith(parent, StringComparison.OrdinalIgnoreCase);
    }
}

internal sealed class IdeContextPayload
{
    public string Source { get; set; } = "visual_studio";
    public DateTimeOffset CapturedAt { get; set; }
    public IdeContextFile? CurrentFile { get; set; }
    public IdeContextSelection? CurrentSelection { get; set; }
}

internal class IdeContextFile
{
    public string Path { get; set; } = "";
    public string RelativePath { get; set; } = "";
    public string Language { get; set; } = "";
    public int Line { get; set; }
    public int Column { get; set; }
}

internal sealed class IdeContextSelection : IdeContextFile
{
    public string Text { get; set; } = "";
    public int StartLine { get; set; }
    public int EndLine { get; set; }
    public bool Truncated { get; set; }
}
