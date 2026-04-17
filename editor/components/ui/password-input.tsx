"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={show ? "text" : "password"}
        className="pr-10"
      />

      <Button
        type="button"
        variant="ghost"
        size="icon"
        tabIndex={-1}
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </Button>
    </div>
  );
}