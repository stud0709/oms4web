import { Hash, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { 
  ScrollArea, 
  ScrollBar } from '@/components/ui/scroll-area';

interface HashtagFilterProps {
  tags: string[];
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
}

export function HashtagFilter({ tags, selectedTag, onSelectTag }: HashtagFilterProps) {
  if (tags.length === 0) return null;

  return (
    <ScrollArea className="w-full whitespace-nowrap">
      <div className="flex gap-2 pb-2">
        {selectedTag && (
          <Badge
            variant="outline"
            className="cursor-pointer hover:bg-destructive/10 border-destructive/50 text-destructive"
            onClick={() => onSelectTag(null)}
          >
            <X className="h-3 w-3 mr-1" />
            Clear filter
          </Badge>
        )}
        {tags.map(tag => {
          const isDeletedTag = tag === 'deleted';
          const isSelected = selectedTag === tag;
          
          return (
            <Badge
              key={tag}
              variant={isSelected ? 'default' : isDeletedTag ? 'destructive' : 'secondary'}
              className={`cursor-pointer transition-all hover:scale-105 ${
                isDeletedTag && !isSelected ? 'opacity-70' : ''
              }`}
              onClick={() => onSelectTag(isSelected ? null : tag)}
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
