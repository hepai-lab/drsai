/**
 * react-router-dom 风格的 hooks，适配 Gatsby 路由系统
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import { navigate as gatsbyNavigate } from "gatsby";

type HistoryTarget = {
    pathname: string;
    search: string;
    hash: string;
};

/** 仅 query/hash 变化且 pathname 不变时走 history，避免 Gatsby 重复拉 page-data.json */
const resolveSamePathTarget = (to: string): HistoryTarget | null => {
    if (typeof window === "undefined") return null;

    if (to.startsWith("?")) {
        return {
            pathname: window.location.pathname,
            search: to,
            hash: window.location.hash,
        };
    }

    if (to.startsWith("#")) {
        return {
            pathname: window.location.pathname,
            search: window.location.search,
            hash: to,
        };
    }

    try {
        const url = new URL(to, window.location.origin);
        if (url.origin !== window.location.origin) return null;
        if (url.pathname === window.location.pathname) {
            return {
                pathname: url.pathname,
                search: url.search,
                hash: url.hash,
            };
        }
    } catch {
        return null;
    }

    return null;
};

export const LOCATION_CHANGE_EVENT = "drsai:locationchange";

/** Gatsby 当前应展示的 pathname；query-only 的 pushState 不会更新它 */
let gatsbySyncedPathname =
    typeof window !== "undefined" ? window.location.pathname : "/";

const syncGatsbyPathnameFromTarget = (to: string) => {
    if (typeof window === "undefined") return;
    try {
        const url = new URL(to, window.location.origin);
        if (url.origin === window.location.origin) {
            gatsbySyncedPathname = url.pathname;
        }
    } catch {
        // ignore malformed targets
    }
};

const notifyLocationChange = () => {
    // Do not dispatch PopStateEvent: Gatsby/@reach/router listens to it and will
    // attempt a full client route transition (dev 404 on menu query changes).
    window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
};

/**
 * Query-only 路由（?menu=&view=&skill=）走 pushState，Gatsby 不知道这些 history 条目。
 * 浏览器后退会触发原生 popstate → Gatsby EnsureResources.loadPageSync(pathname+search)
 * 把 `/?menu=skills_square&skill=...` 当成新页面，匹配 404。
 *
 * 捕获阶段拦住「pathname 没变」的 popstate，不让 Gatsby 处理。
 * 必须等首页资源加载完成后再安装，否则会拦到 Gatsby 自己的首次路由。
 */
const handleBrowserPopState = (event: PopStateEvent) => {
    const nextPathname = window.location.pathname;
    if (nextPathname === gatsbySyncedPathname) {
        event.stopImmediatePropagation();
        notifyLocationChange();
        return;
    }

    gatsbySyncedPathname = nextPathname;
    void gatsbyNavigate(nextPathname, { replace: true });
    notifyLocationChange();
};

const POPSTATE_GUARD = "__drsaiQueryPopstateGuard";

const installQueryPopstateGuard = () => {
    if (typeof window === "undefined") return;
    const w = window as Window & { [POPSTATE_GUARD]?: boolean };
    if (w[POPSTATE_GUARD]) return;
    w[POPSTATE_GUARD] = true;
    window.addEventListener("popstate", handleBrowserPopState, true);
};

const navigateWithHistory = (target: HistoryTarget, replace?: boolean) => {
    const href = `${target.pathname}${target.search}${target.hash}`;
    if (replace) {
        window.history.replaceState(window.history.state, "", href);
    } else {
        window.history.pushState(window.history.state, "", href);
    }
    notifyLocationChange();
};

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
        installQueryPopstateGuard();

        const handleLocationChange = () => {
            const newPathname = window.location.pathname;
            const newSearch = window.location.search;
            const newHash = window.location.hash;

            setPathname((prevPathname) => {
                return prevPathname !== newPathname ? newPathname : prevPathname;
            });
            setSearch((prevSearch) => {
                return prevSearch !== newSearch ? newSearch : prevSearch;
            });
            setHash((prevHash) => {
                return prevHash !== newHash ? newHash : prevHash;
            });
        };

        window.addEventListener("popstate", handleLocationChange);
        window.addEventListener(LOCATION_CHANGE_EVENT, handleLocationChange);

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
            window.removeEventListener(LOCATION_CHANGE_EVENT, handleLocationChange);
            window.history.pushState = originalPushState;
            window.history.replaceState = originalReplaceState;
        };
    }, []);

    return useMemo(
        () => ({
            pathname,
            search,
            hash,
            state: null,
        }),
        [pathname, search, hash]
    );
};

// 模拟 react-router-dom 的 useNavigate
export const useNavigate = (): ((
    to: string | number,
    options?: { replace?: boolean }
) => void) => {
    return useCallback((to: string | number, options?: { replace?: boolean }) => {
        if (typeof to === "number") {
            window.history.go(to);
            return;
        }

        const samePathTarget = resolveSamePathTarget(to);
        if (samePathTarget) {
            const nextHref = `${samePathTarget.pathname}${samePathTarget.search}${samePathTarget.hash}`;
            const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            if (nextHref !== currentHref) {
                navigateWithHistory(samePathTarget, options?.replace);
            }
            return;
        }

        gatsbyNavigate(to, { replace: options?.replace });
        syncGatsbyPathnameFromTarget(to);
    }, []);
};
