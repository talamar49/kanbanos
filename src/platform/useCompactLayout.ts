import { useEffect, useState } from 'react';
import { COMPACT_LAYOUT_QUERY, isCompactLayout } from './runtime';

export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(isCompactLayout);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_LAYOUT_QUERY);
    const update = () => setCompact(isCompactLayout());
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return compact;
}
