import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import type { Item } from '../types/api'
import { approvalLabel, statusLabel } from '../utils/labels'

export function MyItemsPage() {
  const [items, setItems] = useState<Item[]>([])
  useEffect(() => { api.get('/items').then((response) => setItems(response.data.data)) }, [])
  return (
    <section className="panel">
      <h2>Meus itens</h2>
      <div className="table">
        {items.map((item) => (
          <Link to={`/items/${item.id}`} key={item.id}>
            {item.title}
            <span>{statusLabel[item.status]} · {approvalLabel[item.approval_status]}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
