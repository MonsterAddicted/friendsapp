export type LocationMode = 'off' | 'manual' | 'live'

export interface Profile {
  id: string
  username: string
  display_name: string
  emoji: string
  color: string
  location_mode: LocationMode
  ghost_until?: string | null
}

export interface Member extends Profile {
  role: 'admin' | 'member'
}

export interface Group {
  id: string
  name: string
  invite_code: string
  created_by: string
}

export interface Status {
  id: string
  group_id: string
  user_id: string
  emoji: string
  text: string
  created_at: string
}

export interface Loc {
  user_id: string
  lat: number
  lng: number
  accuracy: number | null
  updated_at: string
}

export type MeetupKind = 'party' | 'eat' | 'sport' | 'chill' | 'gaming' | 'other'

export interface Meetup {
  id: string
  group_id: string
  created_by: string
  kind: MeetupKind
  title: string
  details: string | null
  place: string | null
  starts_at: string | null
  cancelled: boolean
  created_at: string
  lat: number | null
  lng: number | null
  poll_locked: boolean
}

export type Answer = 'in' | 'maybe' | 'out'

export interface MeetupResponse {
  meetup_id: string
  user_id: string
  answer: Answer
}

export type UpFor = 'anything' | 'eat' | 'party' | 'sport' | 'chill' | 'gaming'

export interface Availability {
  user_id: string
  until: string
  up_for: UpFor
  note: string | null
  updated_at: string
}

export interface MeetupOption {
  id: string
  meetup_id: string
  kind: 'time' | 'place'
  label: string | null
  starts_at: string | null
  position: number
}

export interface Vote {
  option_id: string
  user_id: string
}

export interface OnTheWay {
  meetup_id: string
  user_id: string
  lat: number
  lng: number
  arrived: boolean
  started_at: string
  updated_at: string
}

export interface Expense {
  id: string
  group_id: string
  meetup_id: string | null
  created_by: string
  paid_by: string
  amount_cents: number
  note: string | null
  is_settlement: boolean
  created_at: string
}

export interface ExpenseShare {
  expense_id: string
  user_id: string
  amount_cents: number
}

export interface Wave {
  id: string
  group_id: string
  from_user: string
  to_user: string
  message: string
  seen: boolean
  created_at: string
}
