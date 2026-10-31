export type LocationMode = 'off' | 'manual' | 'live'

export interface Profile {
  id: string
  username: string
  display_name: string
  emoji: string
  color: string
  location_mode: LocationMode
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
}

export type Answer = 'in' | 'maybe' | 'out'

export interface MeetupResponse {
  meetup_id: string
  user_id: string
  answer: Answer
}
