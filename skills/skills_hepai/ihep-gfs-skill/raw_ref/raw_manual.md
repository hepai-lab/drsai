---
tags: jwanfs
---
# 对象存储 gfs 使用手册
[toc]

## 1 快速开始

### 1.1 登录

访问 https://gfs.ihep.ac.cn/ ，使用高能所统一认证账号登录。

在网页上获取Access Key和Secret Key。
![](https://note.ihep.ac.cn/uploads/d21da6ec-5a4c-40ec-b9b9-9dc7083f01da.png)


### 1.2 Linux客户端挂载

- 安装jcli客户端
    ```bash
    curl https://file-ocloud.ihep.ac.cn/get-jcli.sh | bash
    ```
    配置至用户的HOME目录的bin下，确保可直接在命令行使用jcli命令操作。
    ```    
    mkdir $HOME/bin/
    cp jcli $HOME /bin/
    export PATH=$PATH:$HOME/bin
    echo "export PATH=$PATH:$HOME/bin" >> ~/.bashrc
    ```
    
- 配置认证信息

    ```bash
    jcli auth
    ```
    - 输入Access Key 和 Secret Key
    - 输入网关地址（访问端点）：
        http://gfs.ihep.ac.cn:7100（所内）
        或 https://fgws3-gfs.ihep.ac.cn（所外）
    - 代理可不选
    - 存储桶可默认选0

- 查看存储桶详细信息
    
    ```bash
    jcli ls
    ```
    若能输出无报错，则配置正确，可进行后续操作。
- 挂载
    ```
    jcli mount -f {挂载点} --daemon
    ```
    例如：
    ```
    housiqi@lxlogin003:~$ mkdir /scratchfs/cc/housiqi/gfs_bucket # 创建挂载点
    
    housiqi@lxlogin003:~$ jcli mount -f /scratchfs/cc/housiqi/gfs_bucket/ --daemon # 执行挂载
    提示:调用子进程运行服务...
    
    housiqi@lxlogin003:~$ ls /scratchfs/cc/housiqi/gfs_bucket/ # 验证挂载是否成功，若能看到目录下文件，则表明挂载成功
    'Jwanfs 用户手册【简易版】.pdf'   mydir   tmp   演示目录
    
    housiqi@lxlogin003:~$ df -h # 查看挂载状态
    20005-ihep-imel-120624  512G  3.0M  512G   1% /scratchfs/cc/housiqi/gfs_bucket
    ```
    随后可像访问本地目录一样访问该存储桶内的文件。

## 2 网页端访问
网页地址：https://gfs.ihep.ac.cn/

请使用高能所统一认证账号申请权限并登录系统。账户开通后，将自动为您提供1TB的默认存储空间。


![](https://note.ihep.ac.cn/uploads/fe92e941-3464-4de4-b184-d7e4b42a337f.png)


### 2.1 桶管理
系统提供包括创建、删除、扩容、回收站等功能。

![](https://note.ihep.ac.cn/uploads/2e022f47-bc19-4df3-b6d2-e64eb317bd30.png)


### 2.2 文件管理

遵循网盘级的用户操作逻辑与数据管理模式，提供如下功能：
- 发布资源
- 上传文件
- 下载文件
- 创建目录
- 预览文件
- 删除文件（回收站中文件默认保存**30天**）
- 分享文件（可选分享时长、设置分享密码）

### 2.3 资源广场
用户发布的资源可以从这里获取详细信息，并下载。

### 2.4 个人设置
可修改昵称、邮箱等。

### 2.5 密钥管理（重要）
密钥（AK和SK）是系统识别用户的**唯一凭证**，使用密钥访问网关的操作代表密钥所属人的操作，请妥善保管自己的认证信息。

## 3 客户端
### 3.1 软件下载

下载链接：

| Column 1 | Windows | MacOS | Linux  |
| -------- | -------- | -------- | -------- |
| Inter/AMD 64bit(amd64/x86)     | [下载](https://file-ocloud.ihep.ac.cn/jcli/amd64_win/jcli.exe)     | [下载](https://file-ocloud.ihep.ac.cn/jcli/amd64_mac/jcli)     |[下载](https://file-ocloud.ihep.ac.cn/jcli/amd64/jcli)|
|ARM/Apple-Silicon(arm64/aarch64)|[下载](https://file-ocloud.ihep.ac.cn/jcli/arm64_win/jcli.exe)|[下载](https://file-ocloud.ihep.ac.cn/jcli/arm64_mac/jcli)|[下载](https://file-ocloud.ihep.ac.cn/jcli/arm64/jcli)|

### 3.2 配置环境变量

- Linux
    - 一键安装
        ```
        curl https://file-ocloud.ihep.ac.cn/get-jcli.sh | bash
        ```
    - 手动安装
        下载客户端程序
        ```
        wget https://file-ocloud.ihep.ac.cn/jcli/amd64/jcli
        ```
        把jcli拷贝至```/usr/bin```（root用户）
        ```
        sudo cp jcli /usr/bin/
        ```
        或配置至用户的HOME目录的bin下（普通用户）
        ```
        mkdir $HOME/bin/
        cp jcli $HOME /bin/
        export PATH=$PATH:$HOME/bin
        echo "export PATH=$PATH:$HOME/bin" >> ~/.bashrc
        ```
        安装完成后执行 ```jcli version``` 以确认是否安装成功。
- Windows
    在Windows系统中，将jcli添加到环境变量中以便于全局使用，可以按照以下步骤操作：

    1. 找到jcli文件的位置。
    2. 右键点击电脑屏幕左下角的Windows图标，选择“系统”。
    3. 在系统窗口左侧，点击“高级系统设置”。
    4. 在系统属性窗口中，点击“环境变量”按钮。
    5. 在环境变量窗口中，找到“系统变量”下的“Path”变量，然后点击“编辑”。
    6. 在编辑环境变量窗口中，点击“新建”，然后输入jcli文件所在的目录路径。
    7. 点击“确定”保存更改。

### 3.3 填写认证信息

复制网页上获得的AK、SK以及文件网关，配置客户端并选择对应的存储桶。

网页获取密钥示意图：
![](https://note.ihep.ac.cn/uploads/7330b1e7-bea0-4c9a-a503-612c9c388651.png)

网页获取网关信息示意图：
![](https://note.ihep.ac.cn/uploads/c8504e2b-4aad-4bdd-af04-7a479d9c56f0.png)
注意：其中丹巴网关暂时无法使用

jcli配置认证信息命令：
```bash
jcli auth #或jcli auth -e 重置配置
```
其中，
* AccessKey/SecretKey： 输入从网页端获取的密钥。
* 服务端点： 输入你选择的网页上的网关，例如 ```http://gfs.ihep.ac.cn:7100```
* Bucket 选择： 按提示选择默认存储桶。

### 3.4 挂载作为虚拟磁盘

- Linux
    - 确保已经安装FUSE，一般系统已经内置，如果未安装可参考如下命令进行安装：
        CentOS/openEuler等使用rpm包的系统使用运行如下命令进行安装
        ```
        sudo yum install fuse fuse3
        ```
        Ubuntu/Debian等使用deb包的系统运行如下命令进行安装
        ```
        sudo apt install fuse
        ```
    - 确保已经配置好```jcli auth```
    - 挂载作为共享目录
        - 挂载后配置权限
            ```
            jcli mount -f {挂载点} --daemon
            ```
            例1：修改/tmp/host文件权限为0644(rw-r--r--)
            ```
            #隐性指定参数
            jcli chmod 0644 /tmp/host

            #显性指定参数
            jcli chmod -r /tmp/host -mode 0644
            ```
            例2: 修改/tmp/host文件所有者为root
            ```
            #隐性指定参数
            jcli chown root /tmp/host

            #显性指定参数
            jcli chown -r /tmp/host -u root
            ```
        - 挂载时指定访问权限
            ```
            jcli mount /lact \
                -bucket 20001-lact \ 
                -mode-mnt "0770" \     
                -mode-mnt-uid 0 \    
                -mode-mnt-gid 1000 \    
                -mode-uid 0 \    
                -mode-gid 1000 \
                --daemon
            ```
            *参数说明：*

            - ```-mode-mnt "0770"```: 仅允许所有者(Root)和所属组(lact)读写。

            - ```-mode-*-gid 1000```: 强制文件归属为 GID 1000 的组。
        
- Windows
    - 下载软件WinFSP,[点击此处下载](https://winfsp.dev/rel/)
    - 确保已经配置好```jcli auth```
    - 执行挂载命令 ```jcli mount {盘符}```，Windows的盘符必须从大写的A-Z中选取。

        ```
        jcli mount Z:
        ```
    - 即可像使用本地磁盘一样使用JWanfs统一存储空间

- MacOS
    Mac挂载需要安装MacFUSE，[点击下载安装](https://macfuse.github.io/)。



| 桶内路径 | Windows | Linux |
| -------- | -------- | -------- |
| Image.jpg| Z:\Image.jpg| /home/lhaaso/gfs/Image.jpg|


### 3.5 卸载
    
手动卸载会强制将目录内容写回磁盘上，保障数据安全裸盘。

```
# 个人目录
umount ~/my_data

# 或共享目录
sudo umount /lact
```

### 3.6 交互模式

直接执行 ```jcli``` 将进入交互界面，支持常见命令如 ```ls```、```cd```、```put```、```get``` 等，使用方式与 Linux Shell 类似。 
```jcli put``` 等子命令可实现一次性文件上传，
```jcli mount``` 提供持续挂载的方式用于长时间读写。 
```jcli help``` 可查看详细命令说明。

```
全局参数:
  --help 参数值类型:bool
        打印帮助信息
  -ak 参数值类型:string
        AccessKey
  -auth 参数值类型:string
        认证文件路径
  -bucket 参数值类型:string
        默认存储桶
  -endpoint 参数值类型:string
        服务端点地址
  -sk 参数值类型:string
        SecretKey
子命令列表:
  命令     别名          作用
  auth                       认证服务
  cat                        查看文件内容
  chmod                      修改对象权限
  chown                      修改对象权限
  config                     配置认证信息
  cp       copy              复制对象
  cron     crontab,task      定时任务管理
  rm       delete,del        删除文件
  du       size              计算文件或目录大小
  etag                       计算文件ETag
  expire                     获取AKSK过期时间
  file-server                   启动文件服务器
  ftp                        启动FTP服务端提供局域网用户访问
  get      pull,download     下载文件
  head                       查看文件首部内容
  list     ls,ll             查看文件列表
  md5sum   md5               计算文件MD5
  mkdir                      创建目录
  mount                      挂载存储桶
  mv       move,rename       移动或重命名远端文件
  put      push,upload       上传文件
  quota                      获取文件信息
  stat     stats,info        获取文件信息
  symlink                    修改对象权限
  sync                       同步对象
  tail                       查看文件尾部内容
  token                      创建临时AKSK
  update                     更新客户端版本
  ```

## 4 概念简介

gfs是基于JWanFS构建的统一对象存储实例。系统实施了严格的用户级数据隔离机制，确保每位用户拥有独立、安全的专属存储空间。同时，gfs打通了操作系统壁垒，支持 Windows、Linux、macOS 等多平台环境下的无缝访问，为用户提供类网盘式的轻量化、便捷化数据管理体验。

### 4.1 桶/Bucket

功能类似你熟悉的文件系统根目录，是JWanFS里存储数据的顶层容器。
桶的名称全局唯一，创建后无法修改。
命名规则：只能包括小写字母、数字和短划线（-），必须以小写字母或者数字开头和结尾。

### 4.2 服务端点/文件网关Endpoint

用户访问数据的入口，格式为：ip+端口

gfs目前提供三个网关，已配置负载均衡：
```
http://gfs.ihep.ac.cn:7100
http://gfs02.ihep.ac.cn:7100
http://gfs03.ihep.ac.cn:7100
```

### 4.3访问密钥/AccessKey&SecretKey

访问密钥（由AccessKey与SecretKey组成）是用户访问JWanFS存储服务的核心身份认证凭证，用于对访问请求进行权限校验，保障数据访问的安全性。用户可通过系统[网页管理端](http://gfs.ihep.ac.cn/user/system/accesskey)获取该密钥信息。




  
## 附录
其他使用方式见客户端手册：[jwanfs手册](https://www.jwanfs.com/docs/guide)