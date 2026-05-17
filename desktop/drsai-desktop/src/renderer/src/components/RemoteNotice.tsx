import { Signal } from "../assets/icons";

function RemoteNotice({ feature }: { feature: string }): React.JSX.Element {
  return (
    <div className="remote-notice">
      <Signal size={28} className="remote-notice-icon" />
      <p className="remote-notice-title">Connected to remote Hermes</p>
      <p className="remote-notice-desc">
        {feature} is not available in remote mode. This data lives on the server
        and is not accessible through the API yet.
      </p>
    </div>
  );
}

export default RemoteNotice;
