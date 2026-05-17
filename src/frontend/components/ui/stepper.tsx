import { Check } from "lucide-react";
import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StepperContextValue {
  step: number;
  setStep: (next: number) => void;
  steps: number;
}

const StepperContext = React.createContext<StepperContextValue | null>(null);

function useStepperContext() {
  const context = React.useContext(StepperContext);
  if (!context) {
    throw new Error("Stepper components must be used within <Stepper>");
  }
  return context;
}

export interface StepperProps {
  steps: number;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  className?: string;
  children: React.ReactNode;
}

export function Stepper(props: StepperProps) {
  const { steps, value, defaultValue = 1, onValueChange, className, children } = props;
  const [internalStep, setInternalStep] = React.useState(defaultValue);
  const step = value ?? internalStep;

  const setStep = React.useCallback(
    (next: number) => {
      const normalized = Math.max(1, Math.min(steps, Math.round(next)));
      if (value === undefined) {
        setInternalStep(normalized);
      }
      onValueChange?.(normalized);
    },
    [onValueChange, steps, value],
  );

  return (
    <StepperContext.Provider value={{ step, setStep, steps }}>
      <div className={cn("space-y-6", className)}>{children}</div>
    </StepperContext.Provider>
  );
}

export function StepperList(props: React.ComponentProps<"ol">) {
  const { className, ...rest } = props;
  return <ol className={cn("flex flex-wrap items-start gap-3", className)} {...rest} />;
}

interface StepperItemContextValue {
  itemStep: number;
}

const StepperItemContext = React.createContext<StepperItemContextValue | null>(null);

function useStepperItemContext() {
  const context = React.useContext(StepperItemContext);
  if (!context) {
    throw new Error("Stepper item components must be used within <StepperItem>");
  }
  return context;
}

export interface StepperItemProps extends React.ComponentProps<"li"> {
  step: number;
}

export function StepperItem(props: StepperItemProps) {
  const { step, className, ...rest } = props;
  return (
    <StepperItemContext.Provider value={{ itemStep: step }}>
      <li className={cn("flex items-center gap-3", className)} {...rest} />
    </StepperItemContext.Provider>
  );
}

export function StepperTrigger(props: React.ComponentProps<typeof Button>) {
  const { itemStep } = useStepperItemContext();
  const { step, setStep } = useStepperContext();
  const { className, children, ...rest } = props;

  return (
    <Button
      type="button"
      variant={itemStep === step ? "default" : "outline"}
      className={cn("h-auto min-h-12 gap-3 px-3 py-2", className)}
      onClick={() => setStep(itemStep)}
      {...rest}
    >
      {children}
    </Button>
  );
}

export function StepperIndicator(props: React.ComponentProps<"span">) {
  const { itemStep } = useStepperItemContext();
  const { step } = useStepperContext();
  const complete = itemStep < step;
  const active = itemStep === step;
  const { className, ...rest } = props;

  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
        complete && "border-primary bg-primary text-primary-foreground",
        active && !complete && "border-primary text-primary",
        !complete && !active && "border-border text-muted-foreground",
        className,
      )}
      {...rest}
    >
      {complete ? <Check className="size-3.5" /> : itemStep}
    </span>
  );
}

export function StepperTitle(props: React.ComponentProps<"span">) {
  const { className, ...rest } = props;
  return <span className={cn("block text-sm font-medium", className)} {...rest} />;
}

export function StepperDescription(props: React.ComponentProps<"span">) {
  const { className, ...rest } = props;
  return <span className={cn("block text-xs text-muted-foreground", className)} {...rest} />;
}

export function StepperSeparator(props: React.ComponentProps<"div">) {
  const { className, ...rest } = props;
  return <div className={cn("h-px w-8 bg-border/60", className)} {...rest} />;
}

export interface StepperContentProps extends React.ComponentProps<"div"> {
  step: number;
}

export function StepperContent(props: StepperContentProps) {
  const { step: contentStep, className, children, ...rest } = props;
  const { step } = useStepperContext();

  if (contentStep !== step) {
    return null;
  }

  return (
    <div className={cn("space-y-4", className)} {...rest}>
      {children}
    </div>
  );
}

export function StepperPrev(props: React.ComponentProps<typeof Button>) {
  const { step, setStep } = useStepperContext();
  const { onClick, ...rest } = props;

  return (
    <Button
      type="button"
      variant="outline"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          setStep(step - 1);
        }
      }}
      disabled={step <= 1 || rest.disabled}
      {...rest}
    />
  );
}

export function StepperNext(props: React.ComponentProps<typeof Button>) {
  const { step, setStep, steps } = useStepperContext();
  const { onClick, ...rest } = props;

  return (
    <Button
      type="button"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          setStep(step + 1);
        }
      }}
      disabled={step >= steps || rest.disabled}
      {...rest}
    />
  );
}
