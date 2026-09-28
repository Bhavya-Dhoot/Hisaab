import type { ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';

export function Empty({ icon: IconCmp, message, action }: { icon?: Icon; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-2 py-8 text-center">
      {IconCmp && <IconCmp size={22} className="text-faint" />}
      <p className="text-sm text-muted">{message}</p>
      {action}
    </div>
  );
}
