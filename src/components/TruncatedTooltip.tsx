import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRef, useState } from 'react';

// ... existing imports

export function TruncatedTooltip({ text, className }: { text: string; className?: string }) {
  const [isTruncated, setIsTruncated] = useState(false);
  const textRef = useRef<HTMLHeadingElement>(null);

  const checkTruncation = () => {
    if (textRef.current) {
      const isOverflown = textRef.current.scrollWidth > textRef.current.clientWidth;
      setIsTruncated(isOverflown);
    }
  };

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <h3 
          ref={textRef} 
          onMouseEnter={checkTruncation}
          className={`font-semibold text-lg truncate text-foreground ${className}`}
        >
          {text}
        </h3>
      </TooltipTrigger>
      {isTruncated && (
        <TooltipContent side="top">
          <p className="max-w-xs break-words">{text}</p>
        </TooltipContent>
      )}
    </Tooltip>
  );
}