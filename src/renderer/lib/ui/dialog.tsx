// From Yoda (Apache-2.0) src/renderer/lib/ui/dialog.tsx.
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import { holdNativeDialog } from './native-dialog-layer';

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/30 duration-100  data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className
      )}
      {...props}
    />
  );
}

/** The portal mounts only for a real open/closing dialog. Keep the native
 * layer parked through the popup's lifetime (including close animation). */
function NativeDialogGate({children}:{children:React.ReactNode}) {
  const native=typeof window.electronAPI?.invoke==='function';
  const [status,setStatus]=React.useState<'pending'|'ready'|'failed'>(native?'pending':'ready');
  React.useLayoutEffect(()=>{
    if(!native)return;
    let active=true;
    const lease=holdNativeDialog();
    void lease.ready.then(()=>{if(active)setStatus('ready');},()=>{if(active)setStatus('failed');});
    return()=>{active=false;lease.release();};
  },[native]);
  if(status==='pending')return null;
  if(status==='failed')return <><DialogOverlay/><DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-background p-6 shadow-lg" role="alertdialog"><DialogPrimitive.Title>无法打开对话框</DialogPrimitive.Title><DialogPrimitive.Description>原生显示层暂时不可用，请关闭后重试。</DialogPrimitive.Description><DialogPrimitive.Close render={<Button variant="outline"/>}>关闭</DialogPrimitive.Close></DialogPrimitive.Popup></>;
  return <>{children}</>;
}

function DialogContent({ className, children, backdropProps, ...props }: DialogPrimitive.Popup.Props & { backdropProps?: DialogPrimitive.Backdrop.Props }) {
  return (
    <DialogPortal>
      <NativeDialogGate>
      <DialogOverlay {...backdropProps} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        onKeyDownCapture={(e) => {
          if ((e.metaKey || e.ctrlKey || e.altKey) && e.key === 'Enter') {
            e.preventDefault();
          }
        }}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-background text-sm ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 sm:max-w-lg',
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
      </NativeDialogGate>
    </DialogPortal>
  );
}

function DialogHeader({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<'div'> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-header"
      className="flex items-center gap-2 p-6 justify-between"
      {...props}
    >
      <div className={cn('flex items-center gap-2', className)}>{children}</div>
      {showCloseButton && (
        <DialogPrimitive.Close
          data-slot="dialog-close"
          render={
            <button className="p-0  text-foreground-muted hover:text-foreground hover:bg-transparent bg-transparent" />
          }
        >
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 p-3 border-t border-border bg-background-quaternary-1 sm:flex-row sm:justify-end',
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        'text-sm font-medium text-foreground',
        className
      )}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className
      )}
      {...props}
    />
  );
}

export function DialogContentArea({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="dialog-content-area"
      className={cn('flex flex-col gap-2 w-full min-h-0 overflow-y-auto p-6 pt-0', className)}
    >
      {children}
    </div>
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
