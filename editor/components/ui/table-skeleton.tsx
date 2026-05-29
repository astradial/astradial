import { TableCell, TableRow } from "@/components/ui/table";

interface TableSkeletonProps {
  /** Number of columns the parent table has — must match colSpan / # of <TableHead> */
  cols: number;
  /** How many shimmer rows to render. Default 6. */
  rows?: number;
}

/**
 * Shimmer skeleton rows for any data table.
 *
 * Renders <rows> TableRows, each containing <cols> TableCells, where every
 * cell is a small grey bar that pulses. Use it inside <TableBody> as the
 * loading state — replaces "Loading..." plaintext with a much smoother feel.
 *
 * Example:
 *   <TableBody>
 *     {loading ? (
 *       <TableSkeleton cols={7} />
 *     ) : rows.map(...)}
 *   </TableBody>
 */
export function TableSkeleton({ cols, rows = 6 }: TableSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={`skel-${i}`}>
          {Array.from({ length: cols }).map((__, j) => (
            <TableCell key={j}>
              <div className="h-4 bg-muted/60 rounded animate-pulse" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
