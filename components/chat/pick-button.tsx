"use client";

import { type ButtonHTMLAttributes, useCallback } from "react";

// 一组按钮里点了哪个：把这个按钮对应的值交给 onPick，省得每个按钮写一个箭头函数
export function PickButton<T>({
  value,
  onPick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "value"> & {
  value: T;
  onPick: (value: T) => void;
}) {
  const click = useCallback(() => onPick(value), [onPick, value]);
  return <button {...props} onClick={click} type="button" />;
}
