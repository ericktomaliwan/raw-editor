import Link from 'next/link'

import { clsx } from 'clsx/lite'
import type { ComponentProps, ReactNode } from 'react'

/*
 * A pared-down sibling of the kit's navbars: logo on the left, actions on the
 * right. It has no link list, so it needs no mobile menu (and none of the
 * dialog machinery the full navbars pull in). If the marketing pages grow a
 * real set of nav links, swap this for one of those.
 */

export function NavbarLogo({ className, href, ...props }: { href: string } & Omit<ComponentProps<'a'>, 'href'>) {
  return <Link href={href} {...props} className={clsx('inline-flex items-center gap-2', className)} />
}

export function NavbarWithLogoAndActions({
  logo,
  actions,
  className,
  ...props
}: {
  logo: ReactNode
  actions: ReactNode
} & ComponentProps<'header'>) {
  return (
    <header className={clsx('sticky top-0 z-10 bg-olive-100 dark:bg-olive-950', className)} {...props}>
      <nav aria-label="Site">
        <div className="mx-auto flex h-21 max-w-7xl items-center justify-between gap-4 px-6 lg:px-10">
          <div className="flex items-center">{logo}</div>
          <div className="flex shrink-0 items-center gap-5">{actions}</div>
        </div>
      </nav>
    </header>
  )
}
