export type Family = 'clore' | 'gabriel' | null;
export type Side = 'clore' | 'gabriel' | 'shared';
export type Role = 'user' | 'admin' | 'sysadmin';
export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface User {
  id: number;
  name: string;
  family: Family;
  role: Role;
  hasPin?: boolean;
  phone?: string | null;
  /** A bookable name with no sign-in (kids, friends) — hidden from the login screen. */
  isGuest?: boolean;
}

export interface Room {
  id: number;
  key: string;
  name: string;
  side: Side;
  sort_order: number;
  requires_approval?: 0 | 1;
}

export interface Approval {
  admin_id: number;
  admin_name: string;
  side: 'clore' | 'gabriel' | 'both';
  decision: 'approved' | 'rejected';
  note: string | null;
  created_at: string;
}

export interface BookingGuest {
  room_id: number;
  user_id: number;
  name: string;
}

export interface Booking {
  id: number;
  createdBy: number;
  createdByName: string;
  startDate: string;
  endDate: string;
  isFullRanch: boolean;
  status: BookingStatus;
  notes: string | null;
  isHoliday: boolean;
  holidayName: string | null;
  needs: { clore: boolean; gabriel: boolean; either: boolean };
  rooms: Room[];
  guests: BookingGuest[];
  approvals: Approval[];
  createdAt: string;
}

export interface Availability {
  fullRanchBlocked: null | { bookingId: number; by: string; status: string; start: string; end: string };
  blockedRooms: Record<string, { bookingId: number; status: string; guests: string[]; by: string }>;
  anyBooking: boolean;
  /** Overlapping stays that hold a house room. A Loft-only booking is not one. */
  anyHouseBooking: boolean;
  holiday: string | null;
}

export interface HolidayWindow {
  key: string;
  name: string;
  start: string;
  end: string;
}

export interface ListItem {
  id: number;
  text: string;
  addedAt: string;
  addedBy: string;
  doneAt: string | null;
  doneBy: string | null;
}

export interface ChecklistItem {
  id: number;
  type: 'checkin' | 'checkout';
  text: string;
  sort_order: number;
  checked_at?: string | null;
  checked_by?: string | null;
}
