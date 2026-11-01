import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../lib/app'
import { store } from '../lib/store'
import { t } from '../lib/i18n'
import { enablePush, needsHomeScreen, pushEnabledHere, pushSupported } from '../lib/push'
import { Avatar, Icons } from '../components/ui'

/* ---------------- First-time app tour ---------------- */

const tourKey = (uid: string) => 'tutorial:' + uid

/** Shown once per person and device. Settings → "Show the tour again" brings it back. */
export const tutorialSeen = (uid: string) => !!store.get(tourKey(uid))
export const markTutorialSeen = (uid: string) => store.set(tourKey(uid), '1')

type TabIcon = 'feed' | 'map' | 'meetups' | 'group' | 'me'

interface Slide {
  emoji: string
  tab?: TabIcon
  title: string
  text: string
  points: [string, string][]
}

const SLIDES: Slide[] = [
  {
    emoji: '👋',
    title: 'Welcome to friendsapp',
    text: "Your group's own app. See what your friends are doing, where they are, and who's up for something. No chat chaos.",
    points: [
      ['🔒', 'Only people in your group see your stuff'],
      ['👆', 'Swipe or tap Next for a quick tour (30 seconds)'],
    ],
  },
  {
    emoji: '💬',
    tab: 'feed',
    title: 'Feed: what everyone is doing',
    text: 'Post what you are doing right now. It disappears after 24 hours.',
    points: [
      ['⚡', 'One tap posts a quick status like 📚 Studying or 🎮 Gaming'],
      ['🙋', 'Tap "I\'m free" when you have time, so friends can join'],
      ['👋', 'Tap a friend to wave at them'],
    ],
  },
  {
    emoji: '📍',
    tab: 'map',
    title: 'Map: where everyone is',
    text: 'You decide if friends see you: Off, Tap to share, or Live while the app is open.',
    points: [
      ['👻', 'Ghost mode hides you for a while'],
      ['🗺️', '"Our map" shows every place you met up'],
      ['🆘', 'SOS tells the whole group if something is wrong'],
    ],
  },
  {
    emoji: '📅',
    tab: 'meetups',
    title: 'Meetups: make plans',
    text: 'Start a plan: pizza, party, football, anything. Friends answer I\'m in, Maybe or Can\'t.',
    points: [
      ['🗳️', 'Let friends vote on the time and place'],
      ['🚶', '"I\'m on my way" shows how far away you are'],
      ['🎡', "Can't decide? Spin the wheel"],
    ],
  },
  {
    emoji: '🫂',
    tab: 'group',
    title: 'Group: your crew',
    text: 'Invite friends with a link or QR code. Everything else is for the whole group.',
    points: [
      ['🔥', 'Meet up every week to keep your streak'],
      ['✨', 'A bucket list of things to do together'],
      ['💸', 'Split bills and see who owes who'],
    ],
  },
  {
    emoji: '⚙️',
    tab: 'me',
    title: 'You: your settings',
    text: 'Edit your profile, pick what you get notified about, and choose what friends can see.',
    points: [
      ['🔔', 'Turn on notifications so you never miss a plan'],
      ['🌙', 'Dark mode, language and more'],
    ],
  },
]

export function Tutorial({ onDone }: { onDone: () => void }) {
  const { me } = useApp()
  const [i, setI] = useState(0)
  const [push, setPush] = useState<'idle' | 'on' | 'busy' | 'error'>('idle')
  const startX = useRef<number | null>(null)
  const last = i === SLIDES.length - 1
  const s = SLIDES[i]

  useEffect(() => {
    pushEnabledHere().then((on) => on && setPush('on'))
  }, [])

  function finish() {
    markTutorialSeen(me.id)
    onDone()
  }
  const next = () => (last ? finish() : setI(i + 1))
  const back = () => i > 0 && setI(i - 1)

  async function turnOnPush() {
    setPush('busy')
    try {
      await enablePush()
      setPush('on')
    } catch {
      setPush('error')
    }
  }

  return (
    <div
      className="tour"
      role="dialog"
      aria-label={t('Quick tour')}
      onTouchStart={(e) => (startX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (startX.current === null) return
        const dx = e.changedTouches[0].clientX - startX.current
        startX.current = null
        if (dx < -50) next()
        else if (dx > 50) back()
      }}
    >
      <div className="tour-top">
        <span className="sub tiny">
          {i + 1} / {SLIDES.length}
        </span>
        {!last && (
          <button className="link inline" onClick={finish}>
            {t('Skip')}
          </button>
        )}
      </div>

      <div className="tour-body" key={i}>
        <div className="tour-art">
          {i === 0 ? <Avatar p={me} size={96} /> : <span className="tour-emoji">{s.emoji}</span>}
        </div>
        <h2 className="tour-title">{i === 0 ? t('Hi {name}!', { name: me.display_name }) : t(s.title)}</h2>
        {i === 0 && <p className="tour-kicker">{t(s.title)}</p>}
        <p className="tour-text">{t(s.text)}</p>
        <ul className="tour-points">
          {s.points.map(([e, p]) => (
            <li key={p}>
              <span className="tour-point-emoji">{e}</span>
              <span>{t(p)}</span>
            </li>
          ))}
        </ul>

        {last && pushSupported() && (
          <div className="tour-push">
            {needsHomeScreen() ? (
              <p className="sub">{t('On iPhone, first add friendsapp to your home screen (Share → Add to Home Screen), then open it from there to turn on notifications.')}</p>
            ) : push === 'on' ? (
              <p className="info">{t('Notifications are on 🔔')}</p>
            ) : (
              <>
                <button className="btn ghost block" disabled={push === 'busy'} onClick={turnOnPush}>
                  🔔 {t('Turn on notifications')}
                </button>
                {push === 'error' && <p className="error">{t('Could not turn on notifications.')}</p>}
              </>
            )}
          </div>
        )}
      </div>

      <MiniTabs active={s.tab} />

      <div className="tour-dots" aria-hidden>
        {SLIDES.map((_, j) => (
          <button key={j} className={'tour-dot' + (j === i ? ' on' : '')} onClick={() => setI(j)} tabIndex={-1} />
        ))}
      </div>
      <div className="tour-nav">
        {i > 0 ? (
          <button className="btn ghost" onClick={back}>
            {t('Back')}
          </button>
        ) : (
          <span />
        )}
        <button className="btn grow" onClick={next}>
          {last ? t("Let's go") : t('Next')}
        </button>
      </div>
    </div>
  )
}

/** The real tab bar, drawn small, with the tab this slide is about lit up. */
function MiniTabs({ active }: { active?: TabIcon }) {
  const { me } = useApp()
  const tabs: [TabIcon, string][] = [
    ['feed', 'Feed'],
    ['map', 'Map'],
    ['meetups', 'Meetups'],
    ['group', 'Group'],
    ['me', 'You'],
  ]
  return (
    <div className={'tour-tabs' + (active ? '' : ' idle')}>
      {tabs.map(([id, label]) => (
        <span key={id} className={'tour-tab' + (id === active ? ' on' : '')}>
          {id === 'me' ? <Avatar p={me} size={18} /> : Icons[id]}
          {t(label)}
        </span>
      ))}
    </div>
  )
}

/* ---------------- First time in a group: checklist ---------------- */

interface IntroState {
  dismissed?: boolean
  post?: boolean
  location?: boolean
  meetup?: boolean
}

const introKey = (uid: string, gid: string) => `groupIntro:${uid}:${gid}`
const readIntro = (uid: string, gid: string): IntroState => {
  try {
    return JSON.parse(store.get(introKey(uid, gid)) ?? '{}')
  } catch {
    return {}
  }
}

export function resetGroupIntro(uid: string, gid: string) {
  store.remove(introKey(uid, gid))
}

/** "Getting started in <group>": 4 small steps, ticked off as you do them. */
export function GroupIntro({ posted }: { posted: boolean }) {
  const { me, group, members, goTab, openNewMeetup } = useApp()
  const [st, setSt] = useState<IntroState>(() => readIntro(me.id, group.id))

  useEffect(() => setSt(readIntro(me.id, group.id)), [me.id, group.id])

  const save = (patch: IntroState) => {
    const next = { ...st, ...patch }
    setSt(next)
    store.set(introKey(me.id, group.id), JSON.stringify(next))
  }

  // Posting counts even after the status is gone (24 h)
  useEffect(() => {
    if (posted && !st.post) save({ post: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posted])

  const invited = members.length > 1
  const steps: { id: string; emoji: string; title: string; help: string; done: boolean; go: () => void }[] = [
    {
      id: 'post',
      emoji: '👋',
      title: 'Say hi',
      help: 'Post what you are doing right now',
      done: !!st.post,
      go: () => {
        const el = document.getElementById('status-text')
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el?.focus()
      },
    },
    {
      id: 'location',
      emoji: '📍',
      title: 'Pick your location setting',
      help: 'Off, Tap to share or Live: your choice',
      done: !!st.location,
      go: () => {
        save({ location: true })
        goTab('map')
      },
    },
    {
      id: 'meetup',
      emoji: '📅',
      title: 'Plan something',
      help: 'Pizza, football, gaming… start a meetup',
      done: !!st.meetup,
      go: () => {
        save({ meetup: true })
        openNewMeetup()
      },
    },
    {
      id: 'invite',
      emoji: '🔗',
      title: 'Invite your friends',
      help: invited ? 'Your friends are here' : 'Send the link or show the QR code',
      done: invited,
      go: () => goTab('group'),
    },
  ]
  const doneCount = steps.filter((x) => x.done).length
  const allDone = doneCount === steps.length

  // Gone once dismissed; when everything is done it says "All set" until closed
  if (st.dismissed) return null

  return (
    <section className="card intro">
      <div className="row">
        <div className="grow">
          <p className="label">{t('Getting started')}</p>
          <div className="name big">{allDone ? t("You're all set 🎉") : t('Welcome to {group}!', { group: group.name })}</div>
        </div>
        <button className="icon-btn" aria-label={t('Hide')} onClick={() => save({ dismissed: true })}>
          ✕
        </button>
      </div>
      <div className="intro-bar" aria-label={t('{n} of {total} done', { n: doneCount, total: steps.length })}>
        <i style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      {!allDone && (
        <div className="list">
          {steps.map((x) => (
            <IntroStep key={x.id} emoji={x.emoji} done={x.done} onClick={x.go}>
              <span className="name small block">{t(x.title)}</span>
              <span className="sub tiny block">{t(x.help)}</span>
            </IntroStep>
          ))}
        </div>
      )}
    </section>
  )
}

function IntroStep({ emoji, done, onClick, children }: { emoji: string; done: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={'intro-step' + (done ? ' done' : '')} onClick={onClick} disabled={done}>
      <span className={'check' + (done ? ' on' : '')}>{done ? '✓' : ''}</span>
      <span className="intro-emoji">{emoji}</span>
      <span className="grow">{children}</span>
      {!done && <span className="sub">›</span>}
    </button>
  )
}
