/**
 * Public table names — must match your Supabase schema.
 * If your tables use different casing/names, change only this file.
 */
export const T = {
  users: 'users',
  circles: 'circles',
  circleMembers: 'circle_members',
  invitations: 'invitations',
  slots: 'slots',
  slotVisibilityCircles: 'slot_visibility_circles',
  slotBookings: 'slot_bookings',
  events: 'events',
  eventParticipants: 'event_participants',
} as const;
