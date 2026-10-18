import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SelectContextValue {
	value: string
	onValueChange: (v: string) => void
	open: boolean
	setOpen: React.Dispatch<React.SetStateAction<boolean>>
	selectedLabel: React.ReactNode
	setSelectedLabel: React.Dispatch<React.SetStateAction<React.ReactNode>>
}

const SelectContext = React.createContext<SelectContextValue | undefined>(undefined)

function useSelectCtx() {
	const ctx = React.useContext(SelectContext)
	if (!ctx) throw new Error('Select sub-components must be wrapped in <Select>')
	return ctx
}

function Select({
	children,
	value = '',
	onValueChange = () => {},
	defaultValue,
}: {
	children: React.ReactNode
	value?: string
	onValueChange?: (v: string) => void
	defaultValue?: string
}) {
	const [open, setOpen] = React.useState(false)
	const [selectedLabel, setSelectedLabel] = React.useState<React.ReactNode>(defaultValue ?? value)
	const ref = React.useRef<HTMLDivElement>(null)

	React.useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
		}
		document.addEventListener('mousedown', handler)
		return () => document.removeEventListener('mousedown', handler)
	}, [])

	return (
		<SelectContext.Provider value={{ value, onValueChange, open, setOpen, selectedLabel, setSelectedLabel }}>
			<div ref={ref} className="relative">
				{children}
			</div>
		</SelectContext.Provider>
	)
}

function SelectTrigger({ children, className }: { children: React.ReactNode; className?: string }) {
	const { open, setOpen } = useSelectCtx()
	return (
		<button
			type="button"
			className={cn(
				'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
				className
			)}
			onClick={() => setOpen(o => !o)}
		>
			{children}
			<ChevronDown className={cn('size-4 opacity-50 ml-2 shrink-0 transition-transform duration-150', open && 'rotate-180')} />
		</button>
	)
}

function SelectValue({ placeholder }: { placeholder?: string }) {
	const { selectedLabel, value } = useSelectCtx()
	return <span className="truncate">{selectedLabel || value || placeholder}</span>
}

function SelectContent({ children, className }: { children: React.ReactNode; className?: string }) {
	const { open } = useSelectCtx()
	if (!open) return null
	return (
		<div
			className={cn(
				'absolute z-50 top-full mt-1 w-full min-w-max overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
				className
			)}
		>
			<div className="p-1">{children}</div>
		</div>
	)
}

function SelectItem({
	children,
	value,
	className,
}: {
	children: React.ReactNode
	value: string
	className?: string
}) {
	const ctx = useSelectCtx()

	React.useLayoutEffect(() => {
		if (ctx.value === value) ctx.setSelectedLabel(children)
	}, [ctx.value, value])

	return (
		<div
			className={cn(
				'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
				ctx.value === value && 'bg-accent text-accent-foreground font-medium',
				className
			)}
			onClick={() => {
				ctx.onValueChange(value)
				ctx.setSelectedLabel(children)
				ctx.setOpen(false)
			}}
		>
			{children}
		</div>
	)
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
