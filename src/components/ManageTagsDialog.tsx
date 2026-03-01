import { useMemo, useState } from 'react';
import { Tags, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { normalizeTag } from '@/lib/tagUtils';

interface ManageTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: string[];
  protectedTags?: Set<string>;
  onRename: (from: string, to: string) => void;
  onDelete: (tag: string) => void;
}

export function ManageTagsDialog({
  open,
  onOpenChange,
  tags,
  protectedTags,
  onRename,
  onDelete,
}: ManageTagsDialogProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmDeleteTag, setConfirmDeleteTag] = useState<string | null>(null);

  const sortedTags = useMemo(() => [...tags].sort((a, b) => a.localeCompare(b)), [tags]);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (nextOpen) {
      setDrafts(Object.fromEntries(tags.map(t => [t, t])));
    } else {
      setConfirmDeleteTag(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tags className="h-4 w-4" />
              Manage tags
            </DialogTitle>
          </DialogHeader>

          {sortedTags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tags yet.</p>
          ) : (
            <ScrollArea className="-mx-6 px-6 max-h-[60vh]">
              <div className="space-y-3">
                {sortedTags.map(tag => {
                  const rawDraft = drafts[tag] ?? tag;
                  const normalized = normalizeTag(rawDraft);
                  const canRename = normalized.length > 0 && normalized !== tag;
                  const isProtected = protectedTags?.has(tag) ?? false;

                  return (
                    <div key={tag} className="flex items-center gap-2">
                      <div className="flex-1">
                        <Input
                          value={rawDraft}
                          onChange={(e) => setDrafts(prev => ({ ...prev, [tag]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            e.preventDefault();
                            if (canRename) {
                              onRename(tag, normalized);
                              setDrafts(prev => ({ ...prev, [normalized]: normalized }));
                            }
                          }}
                          placeholder={tag}
                        />
                        {rawDraft && rawDraft !== normalized && (
                          <p className="text-xs text-muted-foreground mt-1">Will be saved as #{normalized}</p>
                        )}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!canRename}
                        onClick={() => onRename(tag, normalized)}
                      >
                        Rename
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        title={isProtected ? 'This tag cannot be deleted' : 'Delete tag'}
                        disabled={isProtected}
                        onClick={() => setConfirmDeleteTag(tag)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDeleteTag} onOpenChange={(open) => !open && setConfirmDeleteTag(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tag</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteTag ? `This removes #${confirmDeleteTag} from all entries.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDeleteTag(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeleteTag) onDelete(confirmDeleteTag);
                setConfirmDeleteTag(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
