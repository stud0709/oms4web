import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  // Prevent Radix Dialog's modal mode from blocking toast interactions.
  // Radix sets `inert` and `aria-hidden` on sibling DOM nodes, which
  // disables pointer events on the Sonner portal. This observer removes
  // those attributes whenever they appear on the toaster container.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const toaster = document.querySelector('[data-sonner-toaster]')?.closest('[data-sonner-toaster]')?.parentElement;
      if (toaster && (toaster.hasAttribute('inert') || toaster.getAttribute('aria-hidden') === 'true')) {
        toaster.removeAttribute('inert');
        toaster.removeAttribute('aria-hidden');
      }
    });

    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['inert', 'aria-hidden'] });
    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      style={{ zIndex: 9999, pointerEvents: 'auto' }}
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
