import icon from "../../assets/icon.png";

function DrSaiLogo({ size = 32 }: { size?: number }): React.JSX.Element {
  return (
    <img
      src={icon}
      width={size}
      height={size}
      className="rounded-xl"
      alt="DrSai"
    />
  );
}

export default DrSaiLogo;
