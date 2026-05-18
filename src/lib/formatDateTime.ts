const APP_TIME_ZONE = 'Asia/Taipei';

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** App 顯示用：台北時間、24 小時制 yyyy/MM/dd HH:mm */
export function formatDateTime24(value: DateInput): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** 僅日期：yyyy/MM/dd */
export function formatDateOnly(value: DateInput): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** 僅時間：HH:mm（24 小時制） */
export function formatTimeOnly24(value: DateInput): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
