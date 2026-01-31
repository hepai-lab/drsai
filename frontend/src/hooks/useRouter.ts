/**
 * react-router-dom 风格的 hooks，适配 Gatsby 路由系统
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import { navigate as gatsbyNavigate } from "gatsby";

// 模拟 react-router-dom 的 useLocation
export const useLocation = () => {
    const [pathname, setPathname] = useState(
        typeof window !== "undefined" ? window.location.pathname : "/"
    );
    const [search, setSearch] = useState(
        typeof window !== "undefined" ? window.location.search : ""
    );
    const [hash, setHash] = useState(
        typeof window !== "undefined" ? window.location.hash : ""
    );

    useEffect(() => {
        const handleLocationChange = () => {
            const newPathname = window.location.pathname;
            const newSearch = window.location.search;
            const newHash = window.location.hash;
            
            setPathname((prevPathname) => {
                // 只有路径真正变化时才更新
                return prevPathname !== newPathname ? newPathname : prevPathname;
            });
            setSearch((prevSearch) => {
                return prevSearch !== newSearch ? newSearch : prevSearch;
            });
            setHash((prevHash) => {
                return prevHash !== newHash ? newHash : prevHash;
            });
        };

        // 监听 popstate 事件（浏览器前进后退）
        window.addEventListener("popstate", handleLocationChange);
        
        // 监听 pushstate/replacestate（Gatsby navigate）
        const originalPushState = window.history.pushState;
        const originalReplaceState = window.history.replaceState;

        window.history.pushState = function (...args) {
            originalPushState.apply(window.history, args);
            handleLocationChange();
        };

        window.history.replaceState = function (...args) {
            originalReplaceState.apply(window.history, args);
            handleLocationChange();
        };

        return () => {
            window.removeEventListener("popstate", handleLocationChange);
            window.history.pushState = originalPushState;
            window.history.replaceState = originalReplaceState;
        };
    }, []);

    // 使用 useMemo 确保对象引用稳定
    return useMemo(() => ({
        pathname,
        search,
        hash,
        state: null,
    }), [pathname, search, hash]);
};

// 模拟 react-router-dom 的 useNavigate
export const useNavigate = (): ((to: string | number, options?: { replace?: boolean }) => void) => {
    // 使用 useCallback 确保函数引用稳定
    return useCallback((to: string | number, options?: { replace?: boolean }) => {
        if (typeof to === "number") {
            // 数字表示前进/后退
            window.history.go(to);
        } else {
            // 字符串表示路径
            const path = to as string;
            if (options?.replace) {
                // 使用 replace 模式
                gatsbyNavigate(path as any);
            } else {
                gatsbyNavigate(path as any);
            }
        }
    }, []);
};
