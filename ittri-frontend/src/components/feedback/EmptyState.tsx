import { Card, CardContent } from '@/components/ui/card'

export function EmptyState({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: React.ReactNode }) {
  return (
    <Card className="text-center">
      <CardContent className="py-12">
        <div className="mx-auto mb-4 h-12 w-12 opacity-60">{icon}</div>
        <h3 className="text-lg font-semibold">{title}</h3>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  )
}
