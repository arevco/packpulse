import React from "react";
import { captureClientException } from "../lib/sentryClient.js";

var DEFAULT_FALLBACK = (
  <div style={{ padding: 40, textAlign: "center", fontFamily: "sans-serif", color: "#888" }}>
    Something went wrong. Please refresh the page.
  </div>
);

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    captureClientException(error, {
      extra: {
        componentStack: errorInfo && errorInfo.componentStack || "",
      },
    });
  }

  render() {
    if (this.state.hasError) return this.props.fallback || DEFAULT_FALLBACK;
    return this.props.children;
  }
}
