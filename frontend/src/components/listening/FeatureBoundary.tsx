import { Component, type ReactNode } from 'react';
export class FeatureBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return {failed:true}; }
  render() {
    if (this.state.failed) return <div className="listening-empty" role="alert"><h2>這個頁面暫時無法載入</h2><p>播放器仍保持連線。可重新整理再試一次。</p><button onClick={() => window.location.reload()}>重新載入</button><a href="?ui=legacy">切回舊版介面</a></div>;
    return this.props.children;
  }
}
