import { useLayoutEffect, useRef } from 'react';
import type { SourceSession } from './session';
import styles from './index.module.less';
export default function SourceEditor({ source, active }: { source: SourceSession; active: boolean }) {
  const parent = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { source.mount(parent.current!); return () => source.unmount(); }, [source]);
  useLayoutEffect(() => { if (active) source.restoreScroll(); }, [active, source]);
  return <div className={styles.source} ref={parent} />;
}
