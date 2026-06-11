import {
  forwardRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  onSearch: (query: string) => void;
  isLoading?: boolean;
  className?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ onSearch, isLoading, className }, ref) => {
    const [query, setQuery] = useState("");

    const submitQuery = () => {
      if (query.trim()) {
        onSearch(query.trim());
      }
    };

    const handleSubmit = (e: FormEvent) => {
      e.preventDefault();
      submitQuery();
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter" || e.nativeEvent.isComposing) {
        return;
      }

      e.preventDefault();
      submitQuery();
    };

    return (
      <form
        onSubmit={handleSubmit}
        className={cn("flex items-center gap-2", className)}
      >
        <Input
          ref={ref}
          type="text"
          placeholder="搜尋歌曲、藝人或貼上 YouTube 連結..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          disabled={isLoading || !query.trim()}
          className="shrink-0 rounded-[20px] px-5"
        >
          {isLoading ? (
            <>
              <Spinner size="sm" />
              <span className="ml-2">搜尋中...</span>
            </>
          ) : (
            "搜尋"
          )}
        </Button>
      </form>
    );
  },
);

SearchInput.displayName = "SearchInput";
