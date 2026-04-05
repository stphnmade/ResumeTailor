import { useEffect, useState } from "react";

const BASE_URL = import.meta.env.BASE_URL || "/";

function normalizedBase() {
  if (!BASE_URL || BASE_URL === "/") {
    return "";
  }
  return BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;
}

export function stripBase(pathname) {
  const base = normalizedBase();
  if (base && pathname.startsWith(base)) {
    const trimmed = pathname.slice(base.length);
    return trimmed || "/";
  }
  return pathname || "/";
}

export function withBase(pathname) {
  const base = normalizedBase();
  if (!base) {
    return pathname;
  }
  if (pathname === "/") {
    return `${base}/`;
  }
  return `${base}${pathname}`;
}

export function useAppPath() {
  const [pathname, setPathname] = useState(() => stripBase(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setPathname(stripBase(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(nextPath) {
    const target = nextPath || "/";
    const nextHref = withBase(target);
    if (nextHref === `${window.location.pathname}${window.location.search}`) {
      return;
    }
    window.history.pushState({}, "", nextHref);
    setPathname(stripBase(window.location.pathname));
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  return { pathname, navigate };
}
