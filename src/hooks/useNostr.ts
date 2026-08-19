import { useContext } from 'react';
import { NostrContext, NostrContextType } from '@/contexts/NostrContext';

export const useNostr = (): NostrContextType => {
  const context = useContext(NostrContext);
  if (!context) {
    throw new Error('useNostr must be used within a NostrProvider');
  }
  return context;
};
