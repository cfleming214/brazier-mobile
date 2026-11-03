export const GO_ACTION = 'go';

/** Where a tapped notification should take the user. Exported for tests. */
export function routeForNotification(
  data: Record<string, unknown> | undefined,
  actionId: string,
): string | null {
  if (!data) return null;
  const watchId = typeof data.watchId === 'string' ? data.watchId : null;
  if (data.type === 'calendar' && typeof data.eventId === 'string')
    return `/calendar?event=${data.eventId}`;
  if (data.type === 'attempt' && typeof data.attemptId === 'string')
    return `/attempt/${data.attemptId}`;
  if (watchId)
    return actionId === GO_ACTION || data.type === 'ready_to_buy'
      ? `/watch/${watchId}?go=1`
      : `/watch/${watchId}`;
  return '/notifications';
}
