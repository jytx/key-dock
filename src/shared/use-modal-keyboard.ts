// 弹窗键盘交互共享逻辑：Escape 关闭、Tab 焦点陷阱、打开时自动聚焦首个可聚焦
// 元素、关闭时归还焦点。账号编辑弹窗与批量添加弹窗共用。
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

// 弹窗内可聚焦元素的选择器（禁用态除外）。
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 装载/卸载弹窗的键盘交互。
 * 兼容 Shadow DOM：焦点位于影子树内时 document.activeElement 是 shadow host，
 * 需取 shadowRoot.activeElement 才是真实焦点元素（登录页浮窗场景）。
 * onClose 经 ref 持有，避免其闭包随父组件渲染变化导致监听器反复重装。
 *
 * @param open 弹窗是否打开（关闭时不做任何绑定）。
 * @param dialogRef 弹窗根元素引用，用于焦点陷阱范围。
 * @param onClose 关闭回调（Escape 触发）。
 */
export function useModalKeyboard(open: boolean, dialogRef: RefObject<HTMLDivElement | null>, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    // 记录打开前的真实焦点元素（影子树内取 shadowRoot.activeElement），卸载时归还。
    const activeHost = document.activeElement as HTMLElement | null;
    const trigger = (activeHost?.shadowRoot?.activeElement as HTMLElement | null) ?? activeHost;
    // 延迟一轮事件循环再聚焦，确保弹窗 DOM 已挂载。
    const timer = setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // 当前焦点同样要穿透 shadow 边界取真实元素。
      const activeEl = document.activeElement as HTMLElement | null;
      const active = (activeEl?.shadowRoot?.activeElement as HTMLElement | null) ?? activeEl;
      if (event.shiftKey) {
        // Shift+Tab 在首个元素上时回卷到末个。
        if (active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        // Tab 在末个元素上时循环回首个。
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [open, dialogRef]);
}
