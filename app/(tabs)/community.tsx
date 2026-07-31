import LeaderboardsScreen from '@/leaderboards/LeaderboardsScreen';

/**
 * Community tab — the standings themselves, not a menu pointing at them.
 * `embedded` drops the back chevron a tab has nothing to use for.
 */
export default function CommunityTab() {
  return <LeaderboardsScreen embedded />;
}
