/**
 * The team's faces on top of Your team: the members of this business's AI
 * team with what they are doing worn on the face (working, waiting for a
 * yes, or still) and the run's own sentence under it (a site reads no
 * sentence: the API keeps it). Read once a minute.
 *
 * The essentials only, the look of the strip both apps drew on their home
 * (2026-10-11): up to four faces, the ones working or waiting for a yes
 * first, and the rest said as "+3". Nothing until the team is known, and
 * nothing when it is the Co-CEO alone and still.
 */
import React, { useEffect, useState } from 'react';
import { OperatorAvatar, OPERATOR_AVATAR_SIZES } from '@yotako/webmaven-ui';
import type { ScreensTransport } from '../host/types';
import { readTeamFaces, type TeamFaceMember } from './reads';

const POLL_MS = 60_000;

export const TEAM_FACES_COPY = { heading: 'Your team' } as const;

/** The most faces shown; the rest are a "+N" chip. */
export const TEAM_FACES_MAX = 4;

/**
 * Which members show, and which are left to "+N": the ones working or
 * waiting for a yes first, then the others, each group in the order the API
 * gives (the Co-CEO first).
 */
export function teamFacesShown(members: readonly TeamFaceMember[], max = TEAM_FACES_MAX): { shown: TeamFaceMember[]; more: TeamFaceMember[] } {
  const busy = members.filter((m) => m.presence !== 'still');
  const still = members.filter((m) => m.presence === 'still');
  const ordered = [...busy, ...still];
  return { shown: ordered.slice(0, max), more: ordered.slice(max) };
}

/** The line under a face: what they are doing, or nothing when still. */
export function teamFaceLine(m: TeamFaceMember): string | null {
  if (m.presence === 'working') return m.line ? `Working: ${m.line}` : 'Working';
  if (m.presence === 'waiting') return 'Waiting for your yes';
  return null;
}

/** "Data Analyst", "Data Analyst and Webmaster", "Data Analyst, Webmaster and SEO Specialist". */
function namesOf(members: readonly TeamFaceMember[]): string {
  const titles = members.map((m) => m.title);
  return titles.length <= 1 ? titles.join('') : `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
}

/** Whether the faces have anything to show: more than the Co-CEO alone and still. */
export function teamFacesShow(members: readonly TeamFaceMember[] | null | undefined): boolean {
  return !!members && !(members.length <= 1 && members.every((m) => m.presence === 'still'));
}

export const TeamFacesView: React.FC<{
  members: readonly TeamFaceMember[];
  heading?: boolean;
  /**
   * 'team' (Your team, the default): the heading, when asked, as a title.
   * 'home' (the team card on Home): always headed by the section's small
   * uppercase label, with room under the strip for the week's plan.
   */
  look?: 'team' | 'home';
}> = ({ members, heading = false, look = 'team' }) => {
  if (!teamFacesShow(members)) return null;
  const { shown, more } = teamFacesShown(members);
  const size = OPERATOR_AVATAR_SIZES.header;
  const home = look === 'home';
  return (
    <section data-testid="team-strip" aria-label={TEAM_FACES_COPY.heading} style={home ? { margin: '0 0 12px' } : { margin: 0 }}>
      {home ? (
        <div style={{ fontSize: 'var(--text-label, 11px)', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>
          {TEAM_FACES_COPY.heading}
        </div>
      ) : heading && (
        <h2 style={{ fontSize: 'var(--text-label, 11px)', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-dim)', margin: '0 0 8px' }}>
          {TEAM_FACES_COPY.heading}
        </h2>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        {shown.map((m) => {
          const line = teamFaceLine(m);
          return (
            <li key={m.id} data-testid="team-member" data-presence={m.presence} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: 260, margin: 0 }}>
              <OperatorAvatar id={m.id} title={m.title} presence={m.presence} size={size} decorative />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 'var(--text-data, 13.5px)', fontWeight: 600, color: 'var(--text)' }}>{m.title}</span>
                {line && (
                  <span style={{ fontSize: 'var(--text-meta, 12.5px)', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line}</span>
                )}
              </span>
            </li>
          );
        })}
        {more.length > 0 && (
          <li data-testid="team-more" style={{ display: 'flex', alignItems: 'center', margin: 0 }}>
            {/* The others, as a count the size of a face. Their names are
                read out and shown on hover. */}
            <span
              role="img"
              aria-label={`${more.length} more: ${namesOf(more)}`}
              title={namesOf(more)}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: size, height: size, borderRadius: 999,
                background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--glass-border)',
                color: 'var(--text-dim)', fontSize: 'var(--text-data, 13.5px)', fontWeight: 600, lineHeight: 1,
              }}
            >
              +{more.length}
            </span>
          </li>
        )}
      </ul>
    </section>
  );
};

/** The members of one business's team, read once a minute; null until known, and on an API without the route. */
export function useTeamFaceMembers(transport: ScreensTransport, instanceId: string | null): TeamFaceMember[] | null {
  const [members, setMembers] = useState<TeamFaceMember[] | null>(null);
  useEffect(() => {
    let alive = true;
    setMembers(null);
    if (!instanceId) return undefined;
    const read = () => {
      readTeamFaces(transport, instanceId)
        .then((m) => { if (alive) setMembers(m); })
        .catch(() => { /* an older API: no faces */ });
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
    // The transport may be a new object on each render: read again only for another business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);
  return members;
}

/** The faces of one business, read once a minute; nothing on an API without the route. */
export const TeamFaces: React.FC<{ transport: ScreensTransport; instanceId: string; heading?: boolean; look?: 'team' | 'home' }> = ({
  transport, instanceId, heading, look,
}) => {
  const members = useTeamFaceMembers(transport, instanceId);
  return members ? <TeamFacesView members={members} heading={heading} look={look} /> : null;
};
