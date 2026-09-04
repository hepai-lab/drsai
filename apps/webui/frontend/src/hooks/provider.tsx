import React, { useState } from "react";
import { getLocalStorage, setLocalStorage } from "../components/utils";
import { message } from "antd";

export interface IUser {
  name: string;
  email?: string;
  avatar_url?: string;
  metadata?: any;
}

export interface AppContextType {
  user: IUser | null;
  setUser: any;
  logout: any;
  cookie_name: string;
  darkMode: string;
  setDarkMode: any;
  lang: "zh" | "en";
  setLang: (lang: "zh" | "en") => void;
}

const cookie_name = "coral_app_cookie_";

export const appContext = React.createContext<AppContextType>(
  {} as AppContextType
);
const Provider = ({ children }: any) => {
  const storedValue = getLocalStorage("darkmode", false);
  const [darkMode, setDarkMode] = useState(
    storedValue === null ? "light" : storedValue === "dark" ? "dark" : "light"
  );

  const [lang, setLangState] = useState<"zh" | "en">(
    () => (getLocalStorage("drsai_lang", false) as "zh" | "en") || "zh"
  );
  const updateLang = (newLang: "zh" | "en") => {
    setLangState(newLang);
    setLocalStorage("drsai_lang", newLang, false);
  };

  const logout = () => {
    message.info("Please implement your own logout logic");
  };

  const updateDarkMode = (darkMode: string) => {
    setDarkMode(darkMode);
    setLocalStorage("darkmode", darkMode, false);
  };

  const setUser = (user: IUser | null) => {
    if (user?.email) {
      setLocalStorage("user_email", user.email, false);
    } else {
      try {
        window.localStorage.removeItem("user_email");
      } catch {
        // ignore
      }
    }
    setUserState(user);
  };

  const [userState, setUserState] = useState<IUser | null>(null);

  React.useEffect(() => {
    const storedEmail = getLocalStorage("user_email", false) as string | null;
    if (storedEmail) {
      setUserState({
        email: storedEmail,
        name: storedEmail,
      });
    }
  }, []);

  return (
    <appContext.Provider
      value={{
        user: userState,
        setUser,
        logout,
        cookie_name,
        darkMode,
        setDarkMode: updateDarkMode,
        lang,
        setLang: updateLang,
      }}
    >
      {children}
    </appContext.Provider>
  );
};

export default ({ element }: any) => <Provider>{element}</Provider>;
