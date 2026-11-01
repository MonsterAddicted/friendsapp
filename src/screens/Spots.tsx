import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { Section } from '../components/ui'
import type { Spot } from '../types'

/** The group's favourite places, kept live. */
export function useSpots() {
  const { group } = useApp()
  const [spots, setSpots] = useState<Spot[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('spots').select('*').eq('group_id', group.id).order('name')
    setSpots((data as Spot[]) ?? [])
  }, [group.id])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('spots-' + group.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'spots', filter: `group_id=eq.${group.id}` }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [group.id, load])

  return { spots, reload: load }
}

export async function saveSpot(groupId: string, userId: string, name: string, pin: { lat: number; lng: number } | null) {
  return supabase.from('spots').insert({ group_id: groupId, created_by: userId, name: name.trim().slice(0, 60), lat: pin?.lat ?? null, lng: pin?.lng ?? null })
}

/** Group tab: list of favourite spots. They're added when making a meetup. */
export function SpotsCard() {
  const { spots } = useSpots()
  const [open, setOpen] = useState(false)

  async function remove(id: string) {
    await supabase.from('spots').delete().eq('id', id)
  }

  return (
    <Section title={t('Favourite spots')}>
      <div className="card">
        {spots.length === 0 ? (
          <p className="sub">{t('No spots yet. When you make a meetup, tick "Save as favourite spot" and it shows up here and on the map.')}</p>
        ) : (
          <>
            <div className="chips wrap">
              {(open ? spots : spots.slice(0, 8)).map((s) => (
                <span className="chip spot-chip" key={s.id}>
                  {s.emoji} {s.name}
                  <button className="chip-x" aria-label={t('Remove {name}', { name: s.name })} onClick={() => remove(s.id)}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
            {spots.length > 8 && (
              <button className="link inline" onClick={() => setOpen((o) => !o)}>
                {open ? t('Show less') : t('Show all {n}', { n: spots.length })}
              </button>
            )}
          </>
        )}
      </div>
    </Section>
  )
}
