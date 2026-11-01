import { routeForNotification } from '@/lib/notificationRoutes';

describe('routeForNotification', () => {
  it('opens Watch Detail when the notification body is tapped', () => {
    expect(
      routeForNotification(
        { type: 'restock', watchId: 'w1' },
        'expo.modules.notifications.actions.DEFAULT',
      ),
    ).toBe('/watch/w1');
  });
  it('goes straight to checkout from the "Go to Checkout" action', () => {
    expect(routeForNotification({ type: 'restock', watchId: 'w1' }, 'go')).toBe('/watch/w1?go=1');
  });
  it('opens checkout for Ready to buy', () => {
    expect(routeForNotification({ type: 'ready_to_buy', watchId: 'w1' }, 'default')).toBe(
      '/watch/w1?go=1',
    );
  });
  it('routes calendar and attempt notifications', () => {
    expect(routeForNotification({ type: 'calendar', eventId: 'e1' }, 'default')).toBe(
      '/calendar?event=e1',
    );
    expect(routeForNotification({ type: 'attempt', attemptId: 'a1' }, 'default')).toBe(
      '/attempt/a1',
    );
  });
  it('falls back to the inbox', () => {
    expect(routeForNotification({ type: 'protection' }, 'default')).toBe('/notifications');
    expect(routeForNotification(undefined, 'default')).toBeNull();
  });
});
