import { Suspense, useEffect } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import {
  EDUCATION_CHAPTERS,
  findEducationChapter,
  type EducationChapter,
} from './educationChapters'

type EducationChapterContentProps = {
  readonly chapter: EducationChapter
  readonly hash: string
}

function EducationChapterContent({
  chapter,
  hash,
}: EducationChapterContentProps) {
  const Chapter = chapter.Content

  useEffect(() => {
    if (hash) {
      const sectionId = decodeURIComponent(hash.slice(1))
      document.getElementById(sectionId)?.scrollIntoView({ block: 'start' })
    }
  }, [hash])

  return <Chapter />
}

export function EducationPage() {
  const { chapterSlug } = useParams()
  const location = useLocation()
  const chapter = findEducationChapter(chapterSlug)

  if (!chapter) {
    return <Navigate replace to="/education/foundations" />
  }

  return (
    <div className="education-layout">
      <aside className="education-sidebar" aria-label="Educational chapters">
        <nav aria-label="Educational chapter navigation">
          <ol className="education-chapter-list">
            {EDUCATION_CHAPTERS.map((item) => (
              <li key={item.slug}>
                <Link
                  aria-current={item.slug === chapter.slug ? 'page' : undefined}
                  className={
                    item.slug === chapter.slug
                      ? 'education-chapter-link education-chapter-link-active'
                      : 'education-chapter-link'
                  }
                  to={`/education/${item.slug}`}
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      </aside>

      <article className="education-article">
        <Suspense
          fallback={
            <p className="education-loading" role="status">
              Loading chapter...
            </p>
          }
        >
          <EducationChapterContent
            chapter={chapter}
            hash={location.hash}
          />
        </Suspense>
      </article>
    </div>
  )
}
