import { toast } from "../../../platform/ui/components/ui/toast.js";

export function kitchenToast(options: Parameters<typeof toast.add>[0]) {
  const onClick = options.actionProps?.onClick;
  let used = false;
  const id = toast.add({
    ...options,
    onClose() {
      used = true;
      options.onClose?.();
    },
    actionProps: onClick ? {
      ...options.actionProps,
      onClick(event) {
        if (used) return;
        used = true;
        toast.close(id);
        onClick(event);
      }
    } : options.actionProps
  });
  return id;
}
