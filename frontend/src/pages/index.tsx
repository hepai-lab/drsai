import * as React from "react";
import MagenticUILayout from "../components/layout";
import { graphql, navigate } from "gatsby";

// markup
const IndexPage = ({ data }: any) => {
  // React.useEffect(() => {
  //   // 没有token则跳转登录
  //   const localToken = localStorage.getItem("token");
  //   if (!localToken) {
  //     navigate("/sso-login");
  //   }
  // }, []);

  // 读取本地token和username
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  const username = typeof window !== "undefined" ? localStorage.getItem("username") : "";

  // return (
  //   <MagenticUILayout meta={data.site.siteMetadata} title="Home" link={"/"}>
  //     <main style={{ height: "100%" }} className=" h-full ">
  //       {/* 显示token和用户名 */}
  //       {token && username && (
  //         <div>
  //           <div>欢迎，{username}！</div>
  //           <div>Token: <code style={{ wordBreak: "break-all" }}>{token}</code></div>
  //         </div>
  //       )}
  //     </main>
  //   </MagenticUILayout>
  // );
  return (
    <MagenticUILayout meta={data.site.siteMetadata} title="Home" link={"/"}>
      <main style={{ height: "100%" }} className=" h-full ">
      </main>
    </MagenticUILayout>
  );
};



export const query = graphql`
  query HomePageQuery {
    site {
      siteMetadata {
        description
        title
      }
    }
  }
`;

export default IndexPage;
