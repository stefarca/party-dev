// One marking of the course, as a swatch of its fill beside its name. A fill
// drawn over something (a slope's chevrons over the turf) gives that as `back`.

export function Legend({
  fill,
  back,
  children,
}: {
  fill: string;
  back?: string;
  children: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <svg viewBox="0 0 8 8" className="size-4 rounded-[3px]">
        {back && <rect width="8" height="8" fill={back} />}
        <rect width="8" height="8" fill={fill} />
      </svg>
      {children}
    </span>
  );
}
