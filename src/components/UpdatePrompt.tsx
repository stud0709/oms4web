import { useEffect, useState } from 'react';
import { Button } from './ui/button';
export function UpdatePrompt() {
  const [available, setAvailable] = useState(() => sessionStorage.getItem('oms_update_available') === '1');
  useEffect(() => {
    const show = () => setAvailable(true);
    window.addEventListener('oms-update-available', show);
    return () => window.removeEventListener('oms-update-available', show);
  }, []);
  if (!available) return null;
  return <div role="status" className="fixed bottom-4 left-4 right-4 z-50 rounded border bg-background p-4 shadow">
    <p className="text-sm">An update is ready. Save your changes and finish any key exchange before reloading.</p>
    <Button size="sm" onClick={() => { sessionStorage.removeItem('oms_update_available'); window.dispatchEvent(new Event('oms-apply-update')); }}>Reload with update</Button>
    <Button size="sm" variant="ghost" onClick={() => setAvailable(false)}>Later</Button>
  </div>;
}
