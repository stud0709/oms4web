import { Hash, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  ScrollArea,
  ScrollBar
} from '@/components/ui/scroll-area';
import { DELETED_TAG } from '@/lib/constants';
import { useRef } from 'react';

interface HashtagFilterProps {
  tags: string[];
  selectedTags: Set<string>;
  onToggleTag: (tag: string) => void;
  onClear: () => void;
}

export function HashtagFilter({ tags, selectedTags, onToggleTag, onClear }: HashtagFilterProps) {
  const handleWheel = (e: React.WheelEvent) => {
    //Find the scrollable viewport (the element with data-radix-scroll-area-viewport)
    const viewport = e.currentTarget.querySelector('[data-radix-scroll-area-viewport]');

    if (viewport && e.deltaY !== 0) {
      //Prevent the main page from scrolling up/down
      e.preventDefault();
      
      //Move the viewport horizontally
      viewport.scrollBy({
        left: e.deltaY * 2, // Multiplier (e.g., * 2) adjusts the speed to your liking
        behavior: 'smooth'
      });
    }
  };

  if (tags.length === 0) return null;

  return (
    <ScrollArea
      className="w-full whitespace-nowrap"
      onWheel={handleWheel}>
      <div className="flex gap-2 pb-2">
        {selectedTags.size > 0 && (
          <Badge
            variant="outline"
            className="cursor-pointer hover:bg-destructive/10 border-destructive/50 text-destructive"
            onClick={onClear}
          >
            <X className="h-3 w-3 mr-1" />
            Clear filter
          </Badge>
        )}
        {tags.map(tag => {
          const isDeletedTag = tag === DELETED_TAG;
          const isSelected = selectedTags.has(tag);

          return (
            <Badge
              key={tag}
              variant={isSelected ? 'default' : isDeletedTag ? 'destructive' : 'secondary'}
              className={`cursor-pointer transition-all hover:scale-105 ${isDeletedTag && !isSelected ? 'opacity-70' : ''}`}
              onClick={() => onToggleTag(tag)}
            >
              <Hash className="h-3 w-3 mr-0.5" />
              {tag}
            </Badge>
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
