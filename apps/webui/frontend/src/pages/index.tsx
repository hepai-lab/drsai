import { graphql } from "gatsby";
import * as React from "react";
import { SessionManager } from "../components/views/manager";

const IndexPage = () => {
  return <SessionManager />;
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
