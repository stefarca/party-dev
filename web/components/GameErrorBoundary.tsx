import { Component } from "react";
import type { ReactNode } from "react";

// Catches a throw from a broken game module's render so it degrades to
// `fallback` instead of white-screening the whole app. Callers key it by
// what it is showing (a match code, a daily game) so that navigating to
// something else always starts with a clean, untripped boundary.
export class GameErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error("game UI crashed", error, info);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
