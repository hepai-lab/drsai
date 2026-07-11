package ai.drsai.remote

import android.os.Bundle
import android.view.View
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import ai.drsai.remote.databinding.ActivityMainBinding
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private val model: MainViewModel by viewModels()
    private val adapter = RowAdapter { row -> row.session?.let(model::open) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.list.layoutManager = LinearLayoutManager(this)
        binding.list.adapter = adapter

        val saved = getSharedPreferences("remote", MODE_PRIVATE).getString("url", "ws://192.168.1.10:8765/attach")
        binding.url.setText(saved)
        binding.connect.setOnClickListener {
            val url = binding.url.text.toString()
            getSharedPreferences("remote", MODE_PRIVATE).edit().putString("url", url).apply()
            model.connect(url)
        }
        binding.back.setOnClickListener { model.loadSessions() }
        binding.send.setOnClickListener {
            val text = binding.input.text.toString()
            model.send(text)
            binding.input.text.clear()
        }
        lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.STARTED) { model.state.collect(::render) } }
    }

    private fun render(state: ScreenState) {
        when (state) {
            is ScreenState.Disconnected -> {
                binding.status.text = state.reason
                binding.connectPanel.visibility = View.VISIBLE
                binding.composer.visibility = View.GONE
                binding.back.visibility = View.GONE
                adapter.submit(emptyList())
            }
            is ScreenState.Sessions -> {
                binding.status.text = "桌面端在线 · ${state.items.size} 个会话"
                binding.connectPanel.visibility = View.GONE
                binding.composer.visibility = View.GONE
                binding.back.visibility = View.GONE
                adapter.submit(state.items.map { Row(it.name, "${it.preview}\n${it.count} 条消息 · ${it.updatedAt}", it) })
            }
            is ScreenState.Chat -> {
                binding.status.text = if (state.streaming) "${state.session.name} · Agent 工作中…" else "${state.session.name} · 就绪"
                binding.connectPanel.visibility = View.GONE
                binding.composer.visibility = View.VISIBLE
                binding.back.visibility = View.VISIBLE
                binding.send.text = if (state.streaming) "等待" else "发送"
                binding.send.isEnabled = !state.streaming
                adapter.submit(state.rows)
                if (state.rows.isNotEmpty()) binding.list.scrollToPosition(state.rows.lastIndex)
            }
        }
    }
}
