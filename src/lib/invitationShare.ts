import * as Linking from 'expo-linking';
import { Share } from 'react-native';

function buildMessage(links: string[]) {
  return `加入我的 FriSlot 密友圈：\n${links.join('\n')}`;
}

export async function shareInvitationLinksGeneric(links: string[]) {
  const message = buildMessage(links);
  await Share.share({ title: 'FriSlot 邀請', message });
}

export async function openEmailForInvitations(links: string[]) {
  const subject = encodeURIComponent('FriSlot 密友圈邀請');
  const body = encodeURIComponent(buildMessage(links));
  const mailto = `mailto:?subject=${subject}&body=${body}`;
  const canOpen = await Linking.canOpenURL(mailto);
  if (!canOpen) {
    throw new Error('目前裝置無法開啟 Email');
  }
  await Linking.openURL(mailto);
}

export async function openLineForInvitations(links: string[]) {
  const message = encodeURIComponent(buildMessage(links));
  const nativeLineUrl = `line://msg/text/${message}`;
  if (await Linking.canOpenURL(nativeLineUrl)) {
    await Linking.openURL(nativeLineUrl);
    return;
  }
  const lineUrl = `https://line.me/R/msg/text/?${message}`;
  const canOpen = await Linking.canOpenURL(lineUrl);
  if (!canOpen) {
    throw new Error('目前裝置無法開啟 LINE 分享');
  }
  await Linking.openURL(lineUrl);
}

export async function openWhatsAppForInvitations(links: string[]) {
  const message = encodeURIComponent(buildMessage(links));
  const url = `whatsapp://send?text=${message}`;
  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) {
    throw new Error('目前裝置無法開啟 WhatsApp');
  }
  await Linking.openURL(url);
}

export async function openTelegramShareForInvitations(links: string[]) {
  const text = encodeURIComponent(buildMessage(links));
  const url = `https://t.me/share/url?text=${text}`;
  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) {
    throw new Error('目前裝置無法開啟 Telegram 分享');
  }
  await Linking.openURL(url);
}
