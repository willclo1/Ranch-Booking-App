import type { BookingStatus, Side } from '../types';

export const SIDE_LABEL: Record<Side, string> = { clore: 'Clore', gabriel: 'Gabriel', shared: 'Shared' };

export function StatusChip({ status }: { status: BookingStatus }) {
  const label = { pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }[status];
  return <span className={`chip chip-${status}`}>{label}</span>;
}

export function SideDot({ side }: { side: Side }) {
  return <span className={`side-dot side-${side}`} aria-hidden="true" />;
}

export function Spinner() {
  return (
    <div className="spinner-wrap" role="status" aria-label="Loading">
      <div className="spinner" />
    </div>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  return <img src="/logo.png" width={size} height={size} alt="AV Ranch" className="logo-img" />;
}
