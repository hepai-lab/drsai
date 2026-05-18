import { useEffect } from "react";
import splashBg from "../../assets/drsaibg.webp";
import splashLogo from "../../assets/splashtext-w.webp";

interface SplashScreenProps {
  onFinished: () => void;
}

function SplashScreen({ onFinished }: SplashScreenProps): React.JSX.Element {
  useEffect(() => {
    onFinished();
  }, [onFinished]);

  return (
    <div className="splash-screen">
      <img className="splash-bg" src={splashBg} alt="" />
      <img className="splash-logo" src={splashLogo} alt="DrSai Agent" />
    </div>
  );
}

export default SplashScreen;
