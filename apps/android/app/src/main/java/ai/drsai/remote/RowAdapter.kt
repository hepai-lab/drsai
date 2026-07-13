package ai.drsai.remote

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import ai.drsai.remote.databinding.ItemRowBinding

class RowAdapter(private val click: (Row) -> Unit) : RecyclerView.Adapter<RowAdapter.Holder>() {
    private var rows = emptyList<Row>()
    fun submit(items: List<Row>) { rows = items; notifyDataSetChanged() }
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(ItemRowBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    override fun getItemCount() = rows.size
    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(rows[position])
    inner class Holder(private val binding: ItemRowBinding) : RecyclerView.ViewHolder(binding.root) {
        fun bind(row: Row) {
            binding.primary.text = row.primary
            binding.secondary.text = row.secondary
            binding.root.setOnClickListener { click(row) }
        }
    }
}
