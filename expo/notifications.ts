import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export async function setupAndroidChannel() {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync('timer', {
    name: 'Timer Alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 500, 200, 500],
    sound: 'default',
    lightColor: '#39ff14',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  })
}

export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted'
}

export async function scheduleTimerNotification(
  endTimestamp: number,
  title: string,
  body: string,
): Promise<string> {
  await Notifications.cancelAllScheduledNotificationsAsync()
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      vibrate: [0, 500, 200, 500],
    },
    trigger: { date: new Date(endTimestamp), channelId: 'timer' },
  })
}

export async function cancelTimerNotification(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync()
}
